import { TAU } from "./math";

import type { Seed } from "./types";

/** Light starts top-left and drifts clockwise on a mid-size orbit. */
export const DEFAULT_SEED: Seed = [TAU * 0.625, TAU * 0.25, TAU * 0.5];

/** A random seed, for shuffles and galleries. */
export function randomSeed(): Seed {
  return [Math.random() * TAU, Math.random() * TAU, Math.random() * TAU];
}
