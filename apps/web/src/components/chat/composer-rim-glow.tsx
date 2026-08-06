import { useEffect, useRef, useState, type RefObject } from "react";
import "./composer-rim-glow.css";

type Layer = { mask: string; pad: number };

const RIM_STOPS = [
  { color: "#000", stop: 0 },
  { color: "#000", stop: 360 },
] as const;

const RIM_LAYERS: Array<{
  strokeWidth: number;
  blur: number;
  alpha: number;
  ring?: number;
}> = [
  { strokeWidth: 0, blur: 0, alpha: 0.55, ring: 1 },
  { strokeWidth: 3, blur: 3, alpha: 0.16 },
  { strokeWidth: 6, blur: 6, alpha: 0.1 },
  { strokeWidth: 10, blur: 8, alpha: 0.06 },
  { strokeWidth: 14, blur: 12, alpha: 0.14 },
];

const CACHE_MAX = 24;

let scratch: HTMLCanvasElement | null = null;
const maskCache = new Map<string, string>();

function padOf(strokeWidth: number, blur: number): number {
  return Math.ceil(strokeWidth + blur * 3);
}

function radiusOf(el: HTMLElement): number {
  const r = parseFloat(getComputedStyle(el).borderRadius) || 0;
  const { width, height } = el.getBoundingClientRect();
  return Math.min(r, width / 2, height / 2);
}

function buildMask(o: {
  width: number;
  height: number;
  radius: number;
  strokeWidth: number;
  blur: number;
  alpha: number;
  ring?: number;
}): string {
  if (typeof document === "undefined") return "";

  const key = [
    Math.round(o.width),
    Math.round(o.height),
    Math.round(o.radius),
    o.strokeWidth,
    o.blur,
    o.alpha,
    o.ring ?? 0,
  ].join("|");
  const hit = maskCache.get(key);
  if (hit !== undefined) return hit;

  const pad = padOf(o.strokeWidth, o.blur);
  const w = Math.max(1, Math.ceil(o.width) + pad * 2);
  const h = Math.max(1, Math.ceil(o.height) + pad * 2);

  if (!scratch) scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d");
  if (!ctx) return "";
  ctx.clearRect(0, 0, w, h);

  if (o.blur) {
    const isSafari =
      typeof navigator !== "undefined" &&
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    ctx.filter = `blur(${isSafari ? o.blur * 0.25 : o.blur}px)`;
  }

  const g = ctx.createConicGradient(0, w / 2, h / 2);
  for (const s of RIM_STOPS) g.addColorStop(s.stop / 360, s.color);
  ctx.strokeStyle = g;
  ctx.fillStyle = g;
  ctx.globalAlpha = o.alpha;

  const x = (w - o.width) / 2;
  const y = (h - o.height) / 2;
  const r = Math.min(o.radius, o.width / 2, o.height / 2);
  ctx.beginPath();
  if (r > 0) ctx.roundRect(x, y, o.width, o.height, r);
  else ctx.rect(x, y, o.width, o.height);

  if (o.strokeWidth) {
    ctx.lineWidth = o.strokeWidth;
    ctx.stroke();
  } else {
    ctx.fill();
    if (o.ring) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      const r2 = Math.max(
        0,
        Math.min(o.radius - o.ring, (o.width - o.ring * 2) / 2, (o.height - o.ring * 2) / 2),
      );
      ctx.beginPath();
      ctx.roundRect(
        x + o.ring,
        y + o.ring,
        Math.max(0, o.width - o.ring * 2),
        Math.max(0, o.height - o.ring * 2),
        r2,
      );
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
  }

  const url = scratch.toDataURL("image/png");
  if (maskCache.size >= CACHE_MAX) {
    const oldest = maskCache.keys().next().value;
    if (oldest !== undefined) maskCache.delete(oldest);
  }
  maskCache.set(key, url);
  return url;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  const hue = ((h % 360) + 360) % 360;
  return a === 1
    ? `hsl(${hue.toFixed(1)} ${s}% ${l}%)`
    : `hsl(${hue.toFixed(1)} ${s}% ${l}% / ${a})`;
}

function rollPalette(el: HTMLElement) {
  const anchor = Math.random() * 360;
  const arc = (90 + Math.random() * 100) * (Math.random() < 0.5 ? -1 : 1);
  const at = (t: number) => anchor + arc * t;
  const s = el.style;
  s.setProperty("--ai-c1", hsl(at(0), 78, 58));
  s.setProperty("--ai-c2", hsl(at(0.18), 42, 82));
  s.setProperty("--ai-c3", hsl(at(0.4), 80, 62));
  s.setProperty("--ai-c4", hsl(at(0.66), 78, 60));
  s.setProperty("--ai-c5", hsl(at(0.88), 76, 58));
  s.setProperty("--ai-c6", hsl(at(1), 70, 74, 0.55));
  s.setProperty("--ai-tail", hsl(at(-0.12), 55, 78, 0.4));
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function useRimLayers(ref: RefObject<HTMLElement | null>, enabled: boolean): Layer[] {
  const [layers, setLayers] = useState<Layer[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setLayers([]);
      return;
    }

    const build = () => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const radius = radiusOf(el);
      setLayers(
        RIM_LAYERS.map((l) => ({
          mask: buildMask({
            width: box.width,
            height: box.height,
            radius,
            strokeWidth: l.strokeWidth,
            blur: l.blur,
            alpha: l.alpha,
            ring: l.ring,
          }),
          pad: padOf(l.strokeWidth, l.blur),
        })).filter((l) => l.mask),
      );
    };

    build();
    let settle: number | null = null;
    const ro = new ResizeObserver(() => {
      if (settle !== null) window.clearTimeout(settle);
      settle = window.setTimeout(build, 120);
    });
    ro.observe(el);
    return () => {
      if (settle !== null) window.clearTimeout(settle);
      ro.disconnect();
    };
  }, [ref, enabled]);

  return layers;
}

function useStreamingOrbit(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    if (!active) {
      host.dataset.playing = "false";
      return;
    }

    rollPalette(host);
    host.dataset.playing = "true";

    const onVis = () => {
      if (document.hidden) {
        host.dataset.playing = "false";
      } else {
        rollPalette(host);
        host.dataset.playing = "true";
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      host.dataset.playing = "false";
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ref, active]);
}

/** Host ref for the composer rim glow wrapper. */
export function useComposerRimHost() {
  return useRef<HTMLDivElement>(null);
}

/** Canvas-masked rainbow rim under the composer while streaming. */
export function ComposerRimGlow({
  hostRef,
  active,
}: {
  hostRef: RefObject<HTMLElement | null>;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const enabled = active && !reduced;
  const layers = useRimLayers(hostRef, enabled);
  useStreamingOrbit(hostRef, enabled);

  if (!enabled || layers.length === 0) return null;

  return (
    <>
      {layers.map((l, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="composer-rim-layer"
          style={{
            inset: `${-l.pad}px`,
            maskImage: `url(${l.mask})`,
            WebkitMaskImage: `url(${l.mask})`,
          }}
        />
      ))}
    </>
  );
}
