import type { ShapeParams } from "./shape";

/** Surface silhouette of the avatar. */
export type Cut =
  "circle" | "squircle" | "square" | "diamond" | "hexagon" | "badge" | "burst";

/** Animation state. Each mood is a seamless loop. */
export type Mood =
  | "idle"
  | "observing"
  | "thinking"
  | "processing"
  | "working"
  | "done"
  | "failed"
  | "invalid"
  | "inactive";

/**
 * How the light moves, as three numbers in 0..2π so `randomSeed()` can draw them uniformly:
 * - `angle`: where the light starts around the centre, in radians.
 * - `drift`: the orbit direction, clockwise when at most π and counter-clockwise above it.
 * - `orbit`: the orbit's size, from 85% of `LIGHT_ORBIT` at 0 to 115% at 2π.
 */
export type Seed = readonly [angle: number, drift: number, orbit: number];

/** Everything the renderer needs to know about an avatar, minus time. */
export interface AvatarSpec {
  /** How the light moves. */
  seed: Seed;
  /** Surface colour, any CSS hex colour (#rgb or #rrggbb). */
  color: string;
  /** Silhouette preset. Its geometry is replaced when `shape` is set. */
  cut: Cut;
  mood: Mood;
  /** Eye colour, hex. */
  eyeColor: string;
  /** Optional custom silhouette from the shape engine; overrides the cut's geometry. */
  shape?: Partial<ShapeParams>;
  /**
   * How far the face pulls toward the centre to fit the silhouette, 0.55..1.
   * When omitted, `computeFrame` uses the cut's value, which is wrong for a
   * custom `shape`. `resolveSpec` fills it in from the shape.
   */
  contentScale?: number;
}

/** One eye (or eye-derived dot) in the 64×64 box. Centre-based so it can rotate. */
export interface EyeRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Corner radius. */
  r: number;
  /** Rotation in radians about the centre. */
  rot: number;
  alpha: number;
}

/** Dizzy swirl drawn over an eye in the `failed` mood. */
export interface Swirl {
  cx: number;
  cy: number;
  /** Radius of the outermost turn, box units. */
  radius: number;
  /** Winding direction: 1 clockwise, -1 counter-clockwise. */
  dir: 1 | -1;
  /** 0..1, how much of the spiral is drawn. */
  grow: number;
  /** Rotation offset in radians. */
  rot: number;
  alpha: number;
}

/** A floating "z" in the `inactive` mood. */
export interface SleepMark {
  /** Centre of the "z". */
  x: number;
  y: number;
  /** Width and height of the "z". */
  size: number;
  strokeWidth: number;
  alpha: number;
}

/** A fully resolved frame: plain numbers, renderer-agnostic. */
export interface Frame {
  /** Seconds into the loop. */
  t: number;
  /** 0..1 phase within the eye cycle. */
  phase: number;
  /** Surface colour for this frame (the `done` mood cycles it). */
  color: string;
  /** Body rotation in degrees about the centre. */
  tilt: number;
  /** Body translation. */
  offset: readonly [number, number];
  /** Light source position in box units: the bright end of the surface gradient. */
  light: readonly [number, number];
  /** Lit hue derived from `color` this frame. */
  lit: string;
  /** Shaded hue derived from `color` this frame. */
  shade: string;
  /** Always four entries. Unused ones have alpha 0. */
  eyes: readonly [EyeRect, EyeRect, EyeRect, EyeRect];
  swirls: readonly Swirl[];
  sleepMarks: readonly SleepMark[];
}
