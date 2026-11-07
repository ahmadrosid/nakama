import { clamp } from "./math";
import { inscribedRadius, radiiToPoints, shapeRadii } from "./shape";

import type { ShapeParams } from "./shape";
import type { AvatarSpec, Cut } from "./types";

export { BOX, CENTER } from "./box";

/** A silhouette preset. */
export interface CutDef {
  label: string;
  /** Parameters for the polar shape engine. */
  shape: Partial<ShapeParams>;
  /** Outline as flat [x, y, …] in box coordinates, SHAPE_SAMPLES points. */
  points: number[];
  /** How far the face pulls toward the centre to fit the silhouette, 0.55..1. */
  contentScale: number;
}

/** Inscribed radius at which the face is drawn full size. A circle's is BODY_RADIUS, 28. */
const FULL_FACE_RADIUS = 27;
/** The face never shrinks below this, however narrow the silhouette. */
const MIN_CONTENT_SCALE = 0.55;

/** Face scale from a silhouette's radii: narrower shapes pull the eyes toward the centre. */
function contentScaleOf(radii: number[]): number {
  return clamp(inscribedRadius(radii) / FULL_FACE_RADIUS, MIN_CONTENT_SCALE, 1);
}

function makeCut(label: string, shape: Partial<ShapeParams>): CutDef {
  const radii = shapeRadii(shape);
  return {
    label,
    shape,
    points: radiiToPoints(radii),
    contentScale: contentScaleOf(radii),
  };
}

export const CUTS: Record<Cut, CutDef> = {
  circle: makeCut("Circle", { n: 2 }),
  squircle: makeCut("Squircle", { n: 4.5 }),
  square: makeCut("Square", { n: 9 }),
  diamond: makeCut("Diamond", { n: 4.5, rot: 45 }),
  hexagon: makeCut("Hexagon", { sides: 6, round: 0.3, rot: -90 }),
  badge: makeCut("Badge", { n: 2.4, lobes: 8, depth: 0.07, sharp: 0.8 }),
  burst: makeCut("Burst", { n: 2, lobes: 12, depth: 0.11, sharp: 1.6 }),
};

/** Cut names in display order. */
export const CUT_KEYS: readonly Cut[] = Object.keys(CUTS) as Cut[];

/**
 * The shape parameters each cut exposes for tuning. Only parameters that
 * visibly change the cut are listed (rotating a circle does nothing).
 */
export const CUT_TUNES = {
  circle: ["n", "ax"],
  squircle: ["n", "rot", "ax"],
  square: ["n", "rot", "ax"],
  diamond: ["n", "rot", "ax"],
  hexagon: ["sides", "round", "rot"],
  badge: ["lobes", "depth", "sharp"],
  burst: ["lobes", "depth", "sharp"],
} as const satisfies Record<Cut, readonly (keyof ShapeParams)[]>;

/** A shape parameter that cut `C` exposes. */
export type TuneKey<C extends Cut = Cut> = (typeof CUT_TUNES)[C][number];

/** Adjustments to a cut's preset, limited to the parameters that cut exposes. */
export type Tune<C extends Cut = Cut> = Partial<Pick<ShapeParams, TuneKey<C>>>;

/** A cut paired with a tune that fits it. */
export type CutTune = {
  [C in Cut]: {
    /** Silhouette preset. */
    cut: C;
    /** Adjustments to the preset, limited to `CUT_TUNES[cut]`. */
    tune?: Tune<C>;
  };
}[Cut];

/** A cut's preset with `tune` applied. Keys the cut doesn't expose are ignored, matching the type. */
export function tunedShape<C extends Cut>(
  cut: C,
  tune: Tune<C>,
): Partial<ShapeParams>;
export function tunedShape(cut: Cut, tune: Tune): Partial<ShapeParams> {
  const shape: Partial<ShapeParams> = { ...CUTS[cut].shape };
  for (const k of CUT_TUNES[cut]) {
    const v = tune[k];
    if (v !== undefined) shape[k] = v;
  }
  return shape;
}

/** Face scale for any shape: how far the eyes pull toward the centre. */
export function shapeContentScale(shape: Partial<ShapeParams>): number {
  return contentScaleOf(shapeRadii(shape));
}

/**
 * Fill in what a spec leaves to be computed: the face scale of a custom
 * `shape`. Plain JS, not for worklets, so resolve once and reuse the result.
 */
export function resolveSpec(spec: AvatarSpec): AvatarSpec {
  if (!spec.shape || spec.contentScale !== undefined) return spec;
  return { ...spec, contentScale: shapeContentScale(spec.shape) };
}

/** Outline points for a spec: its custom shape when set, else its cut. Plain JS, not for worklets. */
export function specPoints(spec: Pick<AvatarSpec, "cut" | "shape">): number[] {
  return spec.shape
    ? radiiToPoints(shapeRadii(spec.shape))
    : CUTS[spec.cut].points;
}

/** A stable key for a spec's silhouette, for caches. */
export function specShapeKey(spec: Pick<AvatarSpec, "cut" | "shape">): string {
  return spec.shape ? "shape:" + JSON.stringify(spec.shape) : "cut:" + spec.cut;
}

/** Radius of the light source's orbit around the centre, in box units, before the seed scales it. */
export const LIGHT_ORBIT = 24;
/** Distance over which the lit hue fades into the shaded hue. */
export const LIGHT_REACH = 74;
/** Luminance amplitude of the grain overlay (0..1). */
export const GRAIN = 0.07;

/** Resting eye geometry in the 64×64 box. */
export const EYE = {
  /** Width. */
  w: 7,
  /** Height. */
  h: 10.5,
  /** Corner radius. */
  r: 2,
  /** Centre x of the left eye. */
  cxL: 22,
  /** Centre x of the right eye. */
  cxR: 42,
  /** Centre y of both eyes, a little below the middle. */
  cy: 43.5,
} as const;
