import { celebrationColor, litShade } from "./color";
import { CENTER, CUTS, EYE, LIGHT_ORBIT } from "./geometry";
import {
  clamp,
  easeBack,
  easeInOut,
  lerp,
  pulse,
  pwl,
  ramp,
  smoothstep,
  TAU,
  wrap01,
} from "./math";
import { MOOD_TABLE } from "./moods";

import type {
  AvatarSpec,
  EyeRect,
  Frame,
  Mood,
  Seed,
  SleepMark,
  Swirl,
} from "./types";

/* ------------------------------------------------------------------
   Everything below is a pure function of (spec, time). It runs on the
   UI thread as a Reanimated worklet in React Native, on the main thread
   in a browser, and in Node. No classes, no closures over
   mutable state, only numbers and plain objects.

   Each mood is one function from a Moment to a MoodState: where the eyes
   are, how the body moves, how far the light has turned. computeFrame
   then applies what every mood shares: the light orbit, the blink squash,
   the content scale and the dizzy swirls.
   ------------------------------------------------------------------ */

/** An eye as a mood places it: in the 64×64 box, before the content scale and the blink squash. */
type Pose = EyeRect;

/** A window over the eye cycle for `pulse`: rises over [0]..[1], holds at 1, falls over [2]..[3]. */
type Window = readonly [
  riseStart: number,
  riseEnd: number,
  fallStart: number,
  fallEnd: number,
];

/** Where a mood is in its loop, plus what the moods need from the spec. */
interface Moment {
  /** 0..1 within the current eye cycle. */
  p: number;
  /** 0..1 within the whole loop. */
  loop: number;
  /** Seconds per eye cycle. */
  cycle: number;
  /** Content scale, for marks placed outside the eyes. */
  cs: number;
  /** The spec's surface colour. */
  color: string;
}

/** What a mood decides for one moment. */
interface MoodState {
  /** Up to four eyes. */
  poses: Pose[];
  /** Body rotation in degrees about the centre. */
  tilt: number;
  /** Body translation, box units. */
  offset: [number, number];
  /** 1 open, 0 shut. */
  openness: number;
  /** Light revolutions so far this loop. Whole turns per loop keep it seamless. */
  lightTurns: number;
  /** Surface colour. */
  color: string;
  /** 0..1, how far the eyes have turned into dizzy swirls. */
  swirl: number;
  sleepMarks: SleepMark[];
}

/** The state every mood starts from: level, centred, eyes open, light still. Moods override what they change. */
function calm(m: Moment, poses: Pose[]): MoodState {
  "worklet";
  return {
    poses,
    tilt: 0,
    offset: [0, 0],
    openness: 1,
    lightTurns: 0,
    color: m.color,
    swirl: 0,
    sleepMarks: [],
  };
}

/** An eye at rest, moved by (dx, dy). Side 0 is the left eye, 1 the right. */
function restPose(side: 0 | 1, dx: number, dy: number): Pose {
  "worklet";
  return {
    cx: (side === 1 ? EYE.cxR : EYE.cxL) + dx,
    cy: EYE.cy + dy,
    w: EYE.w,
    h: EYE.h,
    r: EYE.r,
    rot: 0,
    alpha: 1,
  };
}

/** A round dot of diameter `d` centred at (cx, cy). */
function dotPose(cx: number, cy: number, d: number): Pose {
  "worklet";
  return { cx, cy, w: d, h: d, r: d / 2, rot: 0, alpha: 1 };
}

function lerpPose(a: Pose, b: Pose, u: number): Pose {
  "worklet";
  return {
    cx: lerp(a.cx, b.cx, u),
    cy: lerp(a.cy, b.cy, u),
    w: lerp(a.w, b.w, u),
    h: lerp(a.h, b.h, u),
    r: lerp(a.r, b.r, u),
    rot: lerp(a.rot, b.rot, u),
    alpha: lerp(a.alpha, b.alpha, u),
  };
}

function hiddenEye(): EyeRect {
  "worklet";
  return { cx: CENTER, cy: CENTER, w: 0, h: 0, r: 0, rot: 0, alpha: 0 };
}

/* ---- gaze: keyframed eye offsets, eased between keys ---- */

/** At phase `at`, each eye's offset from rest. `overshoot` 1 eases into this key past the target and back. */
type GazeKey = readonly [
  at: number,
  leftDx: number,
  leftDy: number,
  rightDx: number,
  rightDy: number,
  overshoot: 0 | 1,
];
type Track = readonly GazeKey[];

/** Eye offsets [leftDx, leftDy, rightDx, rightDy] at phase `p`. */
function gazeAt(track: Track, p: number): [number, number, number, number] {
  "worklet";
  for (let k = 0; k < track.length - 1; k++) {
    const a = track[k];
    const b = track[k + 1];
    if (p >= a[0] && p <= b[0]) {
      const u = clamp((p - a[0]) / (b[0] - a[0] || 1), 0, 1);
      const e = b[5] === 1 ? easeBack(u) : easeInOut(u);
      return [
        lerp(a[1], b[1], e),
        lerp(a[2], b[2], e),
        lerp(a[3], b[3], e),
        lerp(a[4], b[4], e),
      ];
    }
  }
  const z = track[track.length - 1];
  return [z[1], z[2], z[3], z[4]];
}

/* ---- blinks: cosine both ways, shut faster than open ---- */

/** Seconds a blink takes to shut and to reopen, before `durationScale`. */
const BLINK_CLOSE = 0.09;
const BLINK_OPEN = 0.14;
/** One blink before the eyes merge into dots (thinking, processing). */
const BLINK_BEFORE_MERGE: readonly number[] = [0.1];
/** One blink before the reaction starts (failed, invalid). */
const BLINK_BEFORE_REACTION: readonly number[] = [0.07];

/** Openness at `d` cycles from a blink's shut moment; `closeN` and `openN` are the shut and reopen spans in cycles. */
function blinkCurve(d: number, closeN: number, openN: number): number {
  "worklet";
  if (d < -closeN || d > openN) return 1;
  if (d < 0) {
    const ph = (d + closeN) / closeN;
    return 0.5 * (1 + Math.cos(Math.PI * ph));
  }
  const ph = d / openN;
  return 0.5 * (1 - Math.cos(Math.PI * ph));
}

/** Eye openness 0..1 at phase `p`, for blinks shut at the given phases. `durationScale` below 1 blinks quicker. */
function opennessAt(
  p: number,
  cycle: number,
  blinks: readonly number[],
  durationScale: number,
): number {
  "worklet";
  let o = 1;
  const cN = (BLINK_CLOSE * durationScale) / cycle;
  const oN = (BLINK_OPEN * durationScale) / cycle;
  for (let i = 0; i < blinks.length; i++) {
    let d = p - blinks[i];
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    o = Math.min(o, blinkCurve(d, cN, oN));
  }
  return clamp(o, 0, 1);
}

/* ---- idle: a small glance up-right, then down-left, with two blinks per cycle ---- */

const IDLE_TRACK: Track = [
  [0, 0, 0, 0, 0, 0],
  [0.3, 1.5, -1, 1.2, -1, 0],
  [0.62, -1.2, 0.6, -1.5, 0.6, 0],
  [1, 0, 0, 0, 0, 0],
];
const IDLE_BLINKS: readonly number[] = [0.3, 0.8];

function idle(m: Moment): MoodState {
  "worklet";
  const [ldx, ldy, rdx, rdy] = gazeAt(IDLE_TRACK, m.p);
  return {
    ...calm(m, [restPose(0, ldx, ldy), restPose(1, rdx, rdy)]),
    openness: opennessAt(m.p, m.cycle, IDLE_BLINKS, 1),
    lightTurns: m.loop,
  };
}

/* ---- observing: looks up-right, then up-left, then back; the head turns with the gaze ---- */

const OBSERVE_TRACK: Track = [
  [0, 0, 0, 0, 0, 0],
  [0.09, 0, 0, 0, 0, 0],
  [0.17, 11, -15, 6, -15, 1],
  [0.33, 11, -15, 6, -15, 0],
  [0.44, -6, -11, -11, -11, 1],
  [0.64, -6, -11, -11, -11, 0],
  [0.72, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0],
];
const OBSERVE_BLINKS: readonly number[] = [0.135, 0.455, 0.735];
/** Sideways gaze at which the head is fully turned. */
const OBSERVE_FULL_TURN = 9.5;
/** How much the far eye narrows when the head is fully turned. */
const OBSERVE_FORESHORTEN = 0.3;
/** Body tilt in degrees per unit of sideways gaze. */
const OBSERVE_TILT = 0.65;

function observing(m: Moment): MoodState {
  "worklet";
  const [ldx, ldy, rdx, rdy] = gazeAt(OBSERVE_TRACK, m.p);
  const look = (ldx + rdx) / 2; // mean sideways gaze, positive to the right
  const narrow =
    1 - clamp(Math.abs(look) / OBSERVE_FULL_TURN, 0, 1) * OBSERVE_FORESHORTEN;
  const left = restPose(0, ldx, ldy);
  const right = restPose(1, rdx, rdy);
  // The eye on the side the head turns toward is further away, so it narrows.
  if (look > 0) right.w *= narrow;
  else if (look < 0) left.w *= narrow;
  return {
    ...calm(m, [left, right]),
    tilt: -look * OBSERVE_TILT,
    openness: opennessAt(m.p, m.cycle, OBSERVE_BLINKS, 1),
    lightTurns: m.loop,
  };
}

/* ---- thinking: the eyes merge into one dot that bobs three times while the light races two laps ---- */

/** The eyes merge into the dot, hold while it bobs, and split again. */
const THINK_MERGE: Window = [0.2, 0.32, 0.82, 0.96];
const THINK_BOBS = 3;
/** How far the dot bobs, and how far the body follows it. */
const THINK_BOB_DOT = 12;
const THINK_BOB_BODY = 1.2;
const THINK_DOT_SIZE = 7.8;
/** Light revolutions against the cycle: slow start, fast middle, slow finish, two laps in all. */
const THINK_LIGHT_TURNS: readonly (readonly [at: number, turns: number])[] = [
  [0, 0],
  [0.32, 0.3],
  [0.82, 1.7],
  [1, 2],
];

function thinking(m: Moment): MoodState {
  "worklet";
  const merge = pulse(m.p, ...THINK_MERGE);
  // The dot bobs while the eyes are fully merged.
  const [, bobStart, bobEnd] = THINK_MERGE;
  const bob = clamp((m.p - bobStart) / (bobEnd - bobStart), 0, 1);
  const wave = Math.sin(TAU * THINK_BOBS * bob);
  const dot = dotPose(CENTER, CENTER + THINK_BOB_DOT * wave, THINK_DOT_SIZE);
  return {
    ...calm(m, [
      lerpPose(restPose(0, 0, 0), dot, merge),
      lerpPose(restPose(1, 0, 0), dot, merge),
    ]),
    offset: [0, bob > 0 && bob < 1 ? THINK_BOB_BODY * wave : 0],
    openness: opennessAt(m.p, m.cycle, BLINK_BEFORE_MERGE, 1),
    lightTurns: pwl(m.p, THINK_LIGHT_TURNS),
  };
}

/* ---- processing: the eyes split into four dots that orbit twice, then gather back ---- */

/** The eyes split into dots, hold while they orbit, and gather back. */
const PROCESS_SPLIT: Window = [0.22, 0.32, 0.86, 0.94];
const PROCESS_SPINS = 2;
const PROCESS_ORBIT = 18;
const PROCESS_DOT_SIZE = 7.4;
/** Each dot's place on the orbit: dots 0 and 1 come from the left eye, 2 and 3 from the right. */
const PROCESS_DOT_ANGLES: readonly number[] = [
  Math.PI,
  Math.PI / 2,
  0,
  -Math.PI / 2,
];

function processing(m: Moment): MoodState {
  "worklet";
  const split = easeInOut(pulse(m.p, ...PROCESS_SPLIT)); // eased twice for a softer start
  const [, spinStart, spinEnd] = PROCESS_SPLIT;
  const spin =
    m.p < spinStart || m.p > spinEnd
      ? 0
      : PROCESS_SPINS *
        TAU *
        easeInOut((m.p - spinStart) / (spinEnd - spinStart));
  const poses: Pose[] = [];
  for (let i = 0; i < 4; i++) {
    const a = PROCESS_DOT_ANGLES[i] + spin;
    const dot = dotPose(
      CENTER + PROCESS_ORBIT * Math.cos(a),
      CENTER + PROCESS_ORBIT * Math.sin(a),
      PROCESS_DOT_SIZE,
    );
    poses.push(lerpPose(restPose(i < 2 ? 0 : 1, 0, 0), dot, split));
  }
  return {
    ...calm(m, poses),
    openness: opennessAt(m.p, m.cycle, BLINK_BEFORE_MERGE, 1),
    lightTurns: m.loop,
  };
}

/* ---- working: the eyes read three lines like text, sweeping right, then back to the next line ---- */

const WORK_LINES = 3;
/** Vertical offset of each line from rest. */
const WORK_LINE_Y: readonly number[] = [-10, -2, 6];
/** Half the width of a sweep. */
const WORK_SWEEP = 9;
/** Share of each line spent reading; the rest is the quick return to the next line. */
const WORK_READ = 0.82;
const WORK_BLINKS: readonly number[] = [0.303, 0.637, 0.97];
/** Body tilt in degrees per unit of sweep. */
const WORK_TILT = 0.35;

function working(m: Moment): MoodState {
  "worklet";
  const along = (m.p * WORK_LINES) % 1; // 0..1 through the current line
  const line = Math.floor(m.p * WORK_LINES) % WORK_LINES;
  let dx: number;
  let dy = WORK_LINE_Y[line];
  if (along < WORK_READ) {
    dx = -WORK_SWEEP + 2 * WORK_SWEEP * (along / WORK_READ);
  } else {
    const back = easeInOut((along - WORK_READ) / (1 - WORK_READ));
    dx = WORK_SWEEP - 2 * WORK_SWEEP * back;
    dy = lerp(dy, WORK_LINE_Y[(line + 1) % WORK_LINES], back);
  }
  return {
    ...calm(m, [restPose(0, dx, dy), restPose(1, dx, dy)]),
    tilt: -WORK_TILT * dx,
    openness: opennessAt(m.p, m.cycle, WORK_BLINKS, 0.7), // quicker blinks while busy
    lightTurns: m.loop,
  };
}

/* ---- done: a happy squint, a jump and a wiggle while the colour runs through the rainbow ---- */

/** The celebration fades in over the cycle's first moments and out over the fade-out window. */
const DONE_FADE_IN = 0.06;
const DONE_FADE_OUT: readonly [start: number, end: number] = [0.65, 0.82];
/** The eyes squint into tilted slits, hold, and reopen. */
const DONE_SQUINT: Window = [0.08, 0.16, 0.36, 0.5];
/** How high the eyes jump, how far they wiggle, and how many wiggles per cycle. */
const DONE_JUMP = 15;
const DONE_WIGGLE = 7;
const DONE_WIGGLES = 7;
/** Body tilt at the height of a wiggle, degrees. */
const DONE_TILT = 12;

function done(m: Moment): MoodState {
  "worklet";
  const p = m.p;
  const joy =
    p < DONE_FADE_IN
      ? p / DONE_FADE_IN
      : 1 - ramp(p, DONE_FADE_OUT[0], DONE_FADE_OUT[1]);
  const squint = pulse(p, ...DONE_SQUINT);
  const wave = Math.sin(TAU * DONE_WIGGLES * p);
  const poses: Pose[] = [];
  for (let i = 0; i < 2; i++) {
    const rest = restPose(i === 1 ? 1 : 0, 0, 0);
    // A flat slit tilted toward the middle: the eyes' "^ ^".
    const slit: Pose = {
      cx: rest.cx,
      cy: rest.cy - 0.5,
      w: 6.2,
      h: 2.4,
      r: 1.2,
      rot: i === 1 ? 0.34 : -0.34,
      alpha: 1,
    };
    const e = lerpPose(rest, slit, squint);
    e.cx += joy * DONE_WIGGLE * wave;
    e.cy -= joy * DONE_JUMP;
    poses.push(e);
  }
  return {
    ...calm(m, poses),
    tilt: joy * DONE_TILT * wave,
    color: celebrationColor(m.color, p, joy),
    lightTurns: m.loop,
  };
}

/* ---- failed: the eyes drop and bounce, the body shakes on impact, the eyes go dizzy, then spring back up ---- */

/** Eye height at rest and on the floor. */
const FALL_TOP = EYE.cy;
const FALL_FLOOR = EYE.cy + 9.5;
const FALL_DROP = FALL_FLOOR - FALL_TOP;
/** The drop starts, bounces until it settles, lies on the floor, then springs back up over the rise window. */
const FALL_START = 0.14;
const FALL_SETTLED = 0.38;
const FALL_RISE: readonly [start: number, end: number] = [0.82, 0.9];
/** The body shakes from the first impact, fading out over the shake's length. */
const FAIL_SHAKE_START = 0.215;
const FAIL_SHAKE_LENGTH = 0.13;
const FAIL_SHAKE = 2.2;
/** The eyes turn into dizzy swirls and back. */
const FAIL_SWIRL: Window = [0.37, 0.53, 0.72, 0.82];
/** Share of its speed a bouncing eye keeps each time it hits the floor. */
const BOUNCE_KEEP = 0.55;

/** Height 0..1 of a ball dropped from 1 at u = 0 that lands, then bounces four times before u = 1. */
function bounceHeight(u: number): number {
  "worklet";
  const r = BOUNCE_KEEP;
  // Each bounce keeps r of the speed, so it lasts r times as long and rises r² as high.
  const durs = [1, 2 * r, 2 * r * r, 2 * r * r * r, 2 * r * r * r * r];
  let total = 0;
  for (let i = 0; i < durs.length; i++) total += durs[i];
  const t = u * total;
  let acc = 0;
  for (let k = 0; k < durs.length; k++) {
    const d = durs[k];
    if (t <= acc + d) {
      const seg = (t - acc) / d;
      if (k === 0) return 1 - seg * seg;
      const hk = Math.pow(r, 2 * k);
      return hk * (1 - Math.pow(2 * seg - 1, 2));
    }
    acc += d;
  }
  return 0;
}

/** Eye centre y at phase `p`. */
function fallenEyeY(p: number): number {
  "worklet";
  if (p < FALL_START) return FALL_TOP;
  if (p < FALL_SETTLED)
    return (
      FALL_FLOOR -
      bounceHeight((p - FALL_START) / (FALL_SETTLED - FALL_START)) * FALL_DROP
    );
  if (p < FALL_RISE[0]) return FALL_FLOOR;
  if (p < FALL_RISE[1])
    return lerp(
      FALL_FLOOR,
      FALL_TOP,
      easeBack((p - FALL_RISE[0]) / (FALL_RISE[1] - FALL_RISE[0])),
    );
  return FALL_TOP;
}

function failed(m: Moment): MoodState {
  "worklet";
  const p = m.p;
  const y = fallenEyeY(p);
  const height = clamp((FALL_FLOOR - y) / FALL_DROP, 0, 1); // 1 at rest, 0 on the floor
  // The eyes stretch as they fall and squash flat near the floor, widening as they flatten.
  const contact = clamp(1 - height / 0.1, 0, 1);
  const sy = lerp(1 + 0.3 * (1 - height), 0.5, contact);
  const sx = 1 / Math.sqrt(sy);
  const w = EYE.w * sx;
  const h = EYE.h * sy;
  const r = Math.min(EYE.r, w / 2, h / 2);
  const poses: Pose[] = [
    { cx: EYE.cxL, cy: y, w, h, r, rot: 0, alpha: 1 },
    { cx: EYE.cxR, cy: y, w, h, r, rot: 0, alpha: 1 },
  ];
  const offset: [number, number] = [0, 0];
  if (p >= FAIL_SHAKE_START && p <= FAIL_SHAKE_START + FAIL_SHAKE_LENGTH) {
    const u = (p - FAIL_SHAKE_START) / FAIL_SHAKE_LENGTH;
    const fade = Math.pow(1 - u, 2);
    offset[0] = FAIL_SHAKE * 0.5 * fade * Math.sin(TAU * 8 * u + 1);
    offset[1] = FAIL_SHAKE * fade * Math.sin(TAU * 9 * u);
  }
  return {
    ...calm(m, poses),
    offset,
    openness: opennessAt(p, m.cycle, BLINK_BEFORE_REACTION, 1),
    swirl: pulse(p, ...FAIL_SWIRL),
  };
}

/* ---- invalid: the eyes narrow to slits and the head shakes "no" three times ---- */

/** The eyes narrow, hold while the head shakes, and reopen. */
const INVALID_SQUINT: Window = [0.2, 0.27, 0.55, 0.63];
const INVALID_SHAKES = 3;
/** Slit height, and how far the eyes and the body swing. */
const INVALID_SLIT = 1.2;
const INVALID_SWING_EYES = 5;
const INVALID_SWING_BODY = 2;

function invalid(m: Moment): MoodState {
  "worklet";
  const p = m.p;
  const squint = pulse(p, ...INVALID_SQUINT);
  // The head shakes while the eyes are fully narrowed.
  const [, shakeStart, shakeEnd] = INVALID_SQUINT;
  const shake =
    p < shakeStart || p > shakeEnd
      ? 0
      : Math.sin(
          TAU * INVALID_SHAKES * ((p - shakeStart) / (shakeEnd - shakeStart)),
        );
  const left = restPose(0, INVALID_SWING_EYES * shake, 0);
  const right = restPose(1, INVALID_SWING_EYES * shake, 0);
  const slit = lerp(EYE.h, INVALID_SLIT, squint);
  left.h = slit;
  right.h = slit;
  return {
    ...calm(m, [left, right]),
    offset: [INVALID_SWING_BODY * shake, 0],
    openness: opennessAt(p, m.cycle, BLINK_BEFORE_REACTION, 1),
  };
}

/* ---- inactive: asleep, the eyes drooped and nearly shut, "z"s drifting up ---- */

/** How far the eyes droop, how open they stay, and how much breathing opens them. */
const SLEEP_DROOP = 4;
const SLEEP_OPEN = 0.05;
const SLEEP_BREATH = 0.02;

/** Three "z"s a third of a cycle apart, each drifting up and right as it grows, fading in and out. */
function sleepMarksAt(p: number, cs: number): SleepMark[] {
  "worklet";
  const marks: SleepMark[] = [];
  for (let k = 0; k < 3; k++) {
    const ph = wrap01(p + k / 3);
    const x = 45 + ph * 6;
    const y = 39 - ph * 18;
    const a = ph < 0.16 ? ph / 0.16 : ph > 0.72 ? (1 - ph) / 0.28 : 1;
    const size = (5 + ph * 4) * cs;
    marks.push({
      x: CENTER + (x - CENTER) * cs,
      y: CENTER + (y - CENTER) * cs,
      size,
      strokeWidth: Math.max(0.6, size * 0.22),
      alpha: clamp(a, 0, 1) * 0.92,
    });
  }
  return marks;
}

function inactive(m: Moment): MoodState {
  "worklet";
  return {
    ...calm(m, [restPose(0, 0, SLEEP_DROOP), restPose(1, 0, SLEEP_DROOP)]),
    openness: SLEEP_OPEN + SLEEP_BREATH * Math.sin(m.p * TAU),
    sleepMarks: sleepMarksAt(m.p, m.cs),
  };
}

/** The state of `mood` at a moment. */
function moodState(mood: Mood, m: Moment): MoodState {
  "worklet";
  switch (mood) {
    case "observing":
      return observing(m);
    case "thinking":
      return thinking(m);
    case "processing":
      return processing(m);
    case "working":
      return working(m);
    case "done":
      return done(m);
    case "failed":
      return failed(m);
    case "invalid":
      return invalid(m);
    case "inactive":
      return inactive(m);
    case "idle":
    default:
      return idle(m);
  }
}

/* ---- assembling the frame ---- */

/** Place a pose in the frame: pull it toward the centre by the content scale and apply the blink squash. */
function finishEye(pose: Pose, cs: number, sx: number, sy: number): EyeRect {
  "worklet";
  const cx = CENTER + (pose.cx - CENTER) * cs;
  const cy = CENTER + (pose.cy - CENTER) * cs;
  const w = pose.w * cs * sx;
  const h = pose.h * cs * sy;
  const r = Math.min(pose.r * cs * Math.min(sx, sy), w / 2, h / 2);
  return { cx, cy, w, h, r: Math.max(0, r), rot: pose.rot, alpha: pose.alpha };
}

/** Stroke width of the dizzy swirls, box units. */
export const SWIRL_STROKE = 0.85;

/** Flat [x0, y0, x1, y1, ...] polyline for a swirl, in box units. */
export function swirlPoints(s: Swirl): number[] {
  "worklet";
  const n = 36;
  const turns = 2.3;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * s.grow;
    const th = s.dir * turns * TAU * f + s.rot;
    const r = s.radius * f;
    out.push(s.cx + r * Math.cos(th), s.cy + r * Math.sin(th));
  }
  return out;
}

/** Flat [x0, y0, ...] polyline for a sleep mark's "z": top stroke, diagonal, bottom stroke. */
export function sleepMarkPoints(m: SleepMark): number[] {
  "worklet";
  const h = m.size / 2;
  return [
    m.x - h,
    m.y - h,
    m.x + h,
    m.y - h,
    m.x - h,
    m.y + h,
    m.x + h,
    m.y + h,
  ];
}

/** Orbit size for the seed's `orbit` at 0, and how much more it gets by 2π, as shares of LIGHT_ORBIT. */
const ORBIT_MIN = 0.85;
const ORBIT_RANGE = 0.3;

/**
 * Where the light is after `turns` revolutions. It orbits the centre; its start,
 * direction and orbit size come from the seed so agents drift differently.
 */
function lightAt(seed: Seed, turns: number): [number, number] {
  "worklet";
  const [startAngle, drift, orbitSize] = seed;
  const dir = drift > Math.PI ? -1 : 1;
  const orbit = LIGHT_ORBIT * (ORBIT_MIN + ORBIT_RANGE * (orbitSize / TAU));
  const angle = startAngle + dir * TAU * turns;
  return [CENTER + orbit * Math.cos(angle), CENTER + orbit * Math.sin(angle)];
}

/**
 * Compute one frame of an avatar at absolute time `t` (seconds).
 * The result is periodic with period `loopLength(spec.mood)`. A spec with a
 * custom `shape` needs its `contentScale`, so pass it through `resolveSpec` first.
 */
export function computeFrame(spec: AvatarSpec, t: number): Frame {
  "worklet";
  const { cycle, reps } = MOOD_TABLE[spec.mood];
  const L = cycle * reps;
  const tl = ((t % L) + L) % L; // seconds into the loop
  const cs =
    spec.contentScale !== undefined
      ? spec.contentScale
      : CUTS[spec.cut].contentScale;
  const moment: Moment = {
    p: wrap01(tl / cycle),
    loop: tl / L,
    cycle,
    cs,
    color: spec.color,
  };
  const s = moodState(spec.mood, moment);

  const light = lightAt(spec.seed, s.lightTurns);
  const [lit, shade] = litShade(s.color);

  // Blink squash: shut eyes get a touch wider and almost flat.
  const sx = 1 + 0.05 * (1 - s.openness);
  const sy = 0.08 + 0.92 * s.openness;
  const eyes: [EyeRect, EyeRect, EyeRect, EyeRect] = [
    hiddenEye(),
    hiddenEye(),
    hiddenEye(),
    hiddenEye(),
  ];
  for (let i = 0; i < s.poses.length && i < 4; i++)
    eyes[i] = finishEye(s.poses[i], cs, sx, sy);

  // Dizzy swirls take over from the eyes as `swirl` rises: the eyes shrink and fade while the spirals grow and unwind.
  const swirls: Swirl[] = [];
  if (s.swirl > 0.001) {
    const grow = smoothstep((s.swirl - 0.12) / 0.88);
    const rot = 1.75 * TAU * Math.pow(1 - s.swirl, 3);
    const eyeScale = clamp(1 - s.swirl * 1.3, 0, 1);
    const eyeAlpha = clamp(1 - s.swirl * 1.6, 0, 1);
    const alpha = clamp(s.swirl * 2.5, 0, 1);
    for (let i = 0; i < 2; i++) {
      const e = eyes[i];
      swirls.push({
        cx: e.cx,
        cy: e.cy,
        radius: 3.6 * cs,
        dir: i === 0 ? -1 : 1,
        grow,
        rot,
        alpha,
      });
      eyes[i] = {
        ...e,
        w: e.w * eyeScale,
        h: e.h * eyeScale,
        r: e.r * eyeScale,
        alpha: eyeAlpha,
      };
    }
  }

  return {
    t: tl,
    phase: moment.p,
    color: s.color,
    tilt: s.tilt,
    offset: s.offset,
    light,
    lit,
    shade,
    eyes,
    swirls,
    sleepMarks: s.sleepMarks,
  };
}

/* ---- stills ---- */

/** Where each mood's key pose falls in its eye cycle: the moment that shows the mood best. */
const KEY_POSE: Readonly<Record<Mood, number>> = {
  idle: 0, // at rest
  observing: 0.25, // looking up and right, head turned
  thinking: 0.57, // the merged dot, centred
  processing: 0.59, // four dots square to the axes, one spin done
  working: 0.137, // mid-sweep along the first line
  done: 0.286, // squinting with the eyes up, the wiggle level
  failed: 0.37, // flattened on the floor, before the swirls
  invalid: 0.41, // narrowed, the head centred mid-shake
  inactive: 0.12, // asleep, all three "z"s in view
};

/**
 * The frame a still avatar shows: the mood's key pose, in the spec's own
 * colour and with the light where the seed starts it, so a list of stills
 * changes only the faces from mood to mood (`done` would otherwise freeze on a
 * rainbow hue). A custom `shape` needs `resolveSpec` first, as for `computeFrame`.
 */
export function stillFrame(spec: AvatarSpec): Frame {
  "worklet";
  const { cycle } = MOOD_TABLE[spec.mood];
  const frame = computeFrame(spec, KEY_POSE[spec.mood] * cycle);
  const [lit, shade] = litShade(spec.color);
  return {
    ...frame,
    color: spec.color,
    light: lightAt(spec.seed, 0),
    lit,
    shade,
  };
}
