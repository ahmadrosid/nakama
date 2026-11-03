import { CENTER } from "./box";
import { clamp, TAU, wrap01 } from "./math";

/**
 * Polar silhouette engine. Every cut is r(θ) sampled at SHAPE_SAMPLES
 * uniform angles, so any two cuts share a point layout and morph freely.
 */

export const SHAPE_SAMPLES = 240;
/** Half of the 56-unit body: shapes are normalised so their bounding box is 56 wide or tall. */
export const BODY_RADIUS = 28;

export interface ShapeParams {
  /** Superellipse exponent: 2 circle, ~4.5 squircle, 9 soft square, 16 square. */
  n: number;
  /** Superellipse width relative to its height: above 1 is wider, below 1 taller. */
  ax: number;
  /** Rotation of the whole shape, degrees. */
  rot: number;
  /** Number of lobes around the edge, 0 for none. */
  lobes: number;
  /** How far lobes push out and valleys cut in, as a fraction of the radius. */
  depth: number;
  /** Lobe profile: 1 is a wave, below 1 gives broad lobes and narrow valleys, above 1 narrow spikes and broad valleys. */
  sharp: number;
  /** Regular polygon sides, or 0 to use the superellipse. */
  sides: number;
  /** Polygon corner rounding, from 0 sharp to 0.5 fully rounded. */
  round: number;
}

export const SHAPE_DEFAULTS: ShapeParams = {
  n: 2,
  ax: 1,
  rot: 0,
  lobes: 0,
  depth: 0,
  sharp: 1,
  sides: 0,
  round: 0.3,
};

/** Superellipse radius at angle `t`, before normalisation. */
function superRadius(n: number, ax: number, t: number): number {
  const c = Math.abs(Math.cos(t)) / ax;
  const s = Math.abs(Math.sin(t));
  return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

/** Points per corner curve and per straight edge in a polygon outline. */
const POLYGON_SEGMENT_POINTS = 24;

/** Dense outline of a regular polygon with quadratic-rounded corners, unit circumradius, vertex 0 at angle 0. */
function polygonOutline(sides: number, round: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const t = (i * TAU) / sides;
    v.push([Math.cos(t), Math.sin(t)]);
  }
  const out: [number, number][] = [];
  const per = POLYGON_SEGMENT_POINTS;
  for (let i = 0; i < sides; i++) {
    const p = v[(i + sides - 1) % sides];
    const c = v[i];
    const nx = v[(i + 1) % sides];
    // The corner curve runs from `a` on the incoming edge, through the vertex's pull, to `b` on the outgoing edge.
    const a: [number, number] = [
      c[0] + (p[0] - c[0]) * round,
      c[1] + (p[1] - c[1]) * round,
    ];
    const b: [number, number] = [
      c[0] + (nx[0] - c[0]) * round,
      c[1] + (nx[1] - c[1]) * round,
    ];
    for (let j = 0; j <= per; j++) {
      const u = j / per;
      const m = 1 - u;
      out.push([
        m * m * a[0] + 2 * m * u * c[0] + u * u * b[0],
        m * m * a[1] + 2 * m * u * c[1] + u * u * b[1],
      ]);
    }
    // straight edge from this corner's exit to the next corner's entry
    const na: [number, number] = [
      nx[0] + (c[0] - nx[0]) * round,
      nx[1] + (c[1] - nx[1]) * round,
    ];
    for (let j = 1; j < per; j++) {
      const u = j / per;
      out.push([b[0] + (na[0] - b[0]) * u, b[1] + (na[1] - b[1]) * u]);
    }
  }
  return out;
}

/** r(θ) at uniform angles for a star-shaped outline, by linear interpolation in polar space. */
function polarResample(outline: [number, number][], count: number): number[] {
  const polar = outline
    .map(
      ([x, y]) =>
        [((Math.atan2(y, x) % TAU) + TAU) % TAU, Math.hypot(x, y)] as [
          number,
          number,
        ],
    )
    .sort((p, q) => p[0] - q[0]);
  const m = polar.length;
  const out: number[] = [];
  // Index of the last outline point at or before the target angle, -1 while the target precedes them all.
  let j = -1;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * TAU;
    while (j < m - 1 && polar[j + 1][0] <= t) j++;
    // The neighbours on either side of t, wrapping across 2π at both ends.
    const a = polar[(j + m) % m];
    const b = polar[(j + 1) % m];
    let span = b[0] - a[0];
    let off = t - a[0];
    if (span <= 0) span += TAU;
    if (off < 0) off += TAU;
    out.push(a[1] + (b[1] - a[1]) * clamp(off / span, 0, 1));
  }
  return out;
}

/** Radii at SHAPE_SAMPLES uniform angles, normalised so the bounding box spans 2×BODY_RADIUS. */
export function shapeRadii(params: Partial<ShapeParams>): number[] {
  const p: ShapeParams = { ...SHAPE_DEFAULTS, ...params };
  const N = SHAPE_SAMPLES;
  const rotRad = (p.rot * Math.PI) / 180;
  const poly =
    p.sides > 0 ? polarResample(polygonOutline(p.sides, p.round), N) : null;
  const radii: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const tl = t - rotRad; // angle in the shape's own, unrotated frame
    let r: number;
    if (poly) {
      const f = wrap01(tl / TAU) * N;
      const k = Math.floor(f);
      const u = f - k;
      r = poly[k % N] * (1 - u) + poly[(k + 1) % N] * u;
    } else {
      r = superRadius(p.n, p.ax, tl);
    }
    if (p.lobes > 0) {
      const w = (Math.cos(p.lobes * tl) + 1) / 2;
      const lobe = Math.pow(w, p.sharp) * 2 - 1;
      r *= 1 + p.depth * lobe;
    }
    radii.push(r);
  }
  let ext = 0;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    ext = Math.max(
      ext,
      Math.abs(radii[i] * Math.cos(t)),
      Math.abs(radii[i] * Math.sin(t)),
    );
  }
  const s = BODY_RADIUS / ext;
  for (let i = 0; i < N; i++) radii[i] *= s;
  return radii;
}

/** Flat [x0, y0, x1, y1, …] outline in box coordinates. */
export function radiiToPoints(radii: number[]): number[] {
  const N = radii.length;
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    out.push(CENTER + radii[i] * Math.cos(t), CENTER + radii[i] * Math.sin(t));
  }
  return out;
}

/** The smallest radius: the largest circle about the centre that fits inside the outline. */
export function inscribedRadius(radii: number[]): number {
  let m = Infinity;
  for (let i = 0; i < radii.length; i++) m = Math.min(m, radii[i]);
  return m;
}

/** SVG path data for an outline. */
export function pointsToPathD(points: number[]): string {
  let d = "";
  for (let i = 0; i < points.length; i += 2)
    d +=
      (i === 0 ? "M" : "L") +
      points[i].toFixed(2) +
      " " +
      points[i + 1].toFixed(2);
  return d + "Z";
}
