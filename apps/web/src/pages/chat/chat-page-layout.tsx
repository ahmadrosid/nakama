import type { ProfileSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { useEffect, useRef } from "react";
import { ChatProfileSwitcher } from "@/components/chat/chat-profile-switcher";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { welcomeAnimationKey } from "@/pages/chat/chat-page.shared";

/**
 * Applied straight to the column rather than as an overlay child, so nothing
 * has to be lifted out of the way with z-index. The gradient is opaque, so the
 * result is identical.
 */
const COGNITO_SURFACE =
  "radial-gradient(125% 125% at 50% 100%, #000000 40%, #010133 100%)";

/** Size of one dither pixel, in CSS pixels. */
const DITHER_CELL_PX = 4;

const DITHER_FRAME_MS = 1000 / 20;

/** Normalised 8x8 Bayer thresholds, the same ordered dither as the logo. */
function bayerThresholds(): number[] {
  let matrix = [[0]];

  while (matrix.length < 8) {
    const prev = matrix;
    const n = prev.length;
    matrix = Array.from({ length: n * 2 }, (_, y) =>
      Array.from(
        { length: n * 2 },
        (_, x) =>
          4 * prev[y % n][x % n] +
          [0, 2, 3, 1][(y >= n ? 2 : 0) + (x >= n ? 1 : 0)]
      )
    );
  }

  return matrix.flat().map((value) => (value + 0.5) / 64);
}

/** Tone at a point: three soft shapes on slow orbits, faded toward the edges. */
function ditherTone(x: number, y: number, aspect: number, t: number): number {
  let tone = 0;

  for (let k = 0; k < 3; k++) {
    const cx = 0.5 + 0.38 * Math.sin(t * 0.000_06 + k * 2.1);
    const cy = 0.5 + 0.34 * Math.cos(t * 0.000_04 + k * 1.7);
    const dx = (x - cx) * aspect;
    const dy = y - cy;
    tone += Math.exp(-(dx * dx + dy * dy) / 0.06);
  }

  const edge = Math.hypot((x - 0.5) * aspect, y - 0.5);

  return Math.min(tone, 1) * 0.55 * Math.max(0, 1 - edge * 1.1);
}

function ChatDitherBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!(canvas && ctx)) {
      return;
    }

    const thresholds = bayerThresholds();
    let image = ctx.createImageData(1, 1);

    const draw = (time: number) => {
      const { width, height, data } = image;
      const aspect = width / height;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tone = ditherTone(x / width, y / height, aspect, time);
          const on = tone > thresholds[(y % 8) * 8 + (x % 8)];
          data[(y * width + x) * 4 + 3] = on ? 255 : 0;
        }
      }

      ctx.globalCompositeOperation = "copy";
      ctx.putImageData(image, 0, 0);
      // Recolour the mask with the theme text colour, whatever format it is in.
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = getComputedStyle(canvas).color;
      ctx.fillRect(0, 0, width, height);
    };

    const resize = () => {
      canvas.width = Math.max(
        1,
        Math.ceil(canvas.clientWidth / DITHER_CELL_PX)
      );
      canvas.height = Math.max(
        1,
        Math.ceil(canvas.clientHeight / DITHER_CELL_PX)
      );
      image = ctx.createImageData(canvas.width, canvas.height);
      draw(performance.now());
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => observer.disconnect();
    }

    let frame = 0;
    let last = 0;

    const tick = (time: number) => {
      if (time - last >= DITHER_FRAME_MS) {
        last = time;
        draw(time);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 size-full text-foreground opacity-[0.03] [image-rendering:pixelated] dark:opacity-[0.04]"
      ref={canvasRef}
    />
  );
}

export function ChatPageColumn({
  children,
  centered = false,
  cognito = false,
}: {
  children: React.ReactNode;
  centered?: boolean;
  cognito?: boolean;
}) {
  const attachmentPanel = useChatAttachmentPanel();

  return (
    <div
      className={cn(
        cognito && "dark",
        // `relative` so a page-level control can pin itself to this column's
        // top-right corner, which is the top-right of the screen area.
        "relative isolate flex min-h-0 min-w-0 flex-col transition-[width,opacity,padding] duration-200 ease-out motion-reduce:transition-none",
        attachmentPanel.isFullscreen
          ? "pointer-events-none w-0 flex-none overflow-hidden px-0 opacity-0"
          : "flex-1 px-3 sm:px-6",
        // No room for two columns on a phone, so an open panel takes over.
        attachmentPanel.isOpen &&
          "max-sm:pointer-events-none max-sm:w-0 max-sm:flex-none max-sm:overflow-hidden max-sm:px-0 max-sm:opacity-0",
        centered && "justify-center"
      )}
      // `dark` is a plain class here, not html.dark, so it re-declares the
      // colour tokens for this subtree only. Without it a light theme would
      // paint dark text onto the near-black gradient.
      style={cognito ? { background: COGNITO_SURFACE } : undefined}
    >
      {centered && !cognito && <ChatDitherBackground />}
      {children}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return `Hi, good ${partOfDay}!`;
}

/**
 * In cognito the pleasantry is the least useful thing on screen, so the slot
 * says what the mode actually does instead.
 */
function CognitoWelcome() {
  return (
    <>
      <h2 className="type-section-title text-xl tracking-tight">
        Cognito chat
      </h2>
      <p className="type-body text-muted-foreground text-sm">
        Not saved, never in History, never written to memory. Reloading the page
        ends it. It still uses memory, plugins, skills and this agent's
        instructions.
      </p>
    </>
  );
}

export function ChatWelcome({
  profile,
  profileId,
  profiles,
  onProfileSwitch,
  profileSwitchDisabled = false,
  cognito = false,
}: {
  profile: ProfileSummary | undefined;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileSwitch: (profileId: string) => void;
  profileSwitchDisabled?: boolean;
  cognito?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 pb-2">
      {/*
        Keyed so React remounts the block on every switch, which replays the
        entrance animation.
      */}
      <div
        className="fade-in-0 slide-in-from-top-1 flex animate-in flex-col gap-2 duration-300 motion-reduce:animate-none"
        key={welcomeAnimationKey(cognito)}
      >
        {cognito ? (
          <CognitoWelcome />
        ) : (
          <h2 className="type-section-title text-xl tracking-tight">
            {greeting()}
          </h2>
        )}
      </div>
      <div className="flex items-center gap-2 self-start">
        <span className="type-body text-muted-foreground text-sm">
          Select agent
        </span>
        <ChatProfileSwitcher
          activeProfile={profile}
          disabled={profileSwitchDisabled}
          onProfileSwitch={onProfileSwitch}
          profileId={profileId}
          profiles={profiles}
          variant="prominent"
        />
      </div>
    </div>
  );
}
