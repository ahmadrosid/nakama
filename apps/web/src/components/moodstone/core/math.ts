export const TAU = Math.PI * 2;

export function clamp(v: number, a: number, b: number): number {
  "worklet";
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, u: number): number {
  "worklet";
  return a + (b - a) * u;
}

export function wrap01(x: number): number {
  "worklet";
  return ((x % 1) + 1) % 1;
}

export function easeInOut(x: number): number {
  "worklet";
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Overshoots slightly past 1 before settling. */
export function easeBack(x: number): number {
  "worklet";
  const c = 2.2;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}

export function smoothstep(x: number): number {
  "worklet";
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}

/** Piecewise-linear interpolation over points sorted by x. Holds the end values outside the range. */
export function pwl(
  x: number,
  pts: readonly (readonly [number, number])[],
): number {
  "worklet";
  if (x <= pts[0][0]) return pts[0][1];
  for (let k = 0; k < pts.length - 1; k++) {
    const b = pts[k + 1];
    if (x <= b[0]) {
      const a = pts[k];
      return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0] || 1));
    }
  }
  return pts[pts.length - 1][1];
}

/** 0 before `a`, eased 0→1 between `a` and `b`, 1 after. */
export function ramp(p: number, a: number, b: number): number {
  "worklet";
  if (p <= a) return 0;
  if (p >= b) return 1;
  return easeInOut((p - a) / (b - a));
}

/** Rises over a..b, holds at 1, falls over c..d. */
export function pulse(
  p: number,
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  "worklet";
  return ramp(p, a, b) - ramp(p, c, d);
}
