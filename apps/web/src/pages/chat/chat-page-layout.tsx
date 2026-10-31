import type { ProfileSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
} from "hugeicons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChatProfileSwitcher } from "@/components/chat/chat-profile-switcher";
import {
  RecentChatsDialogs,
  type SessionTarget,
} from "@/components/sidebar-recents";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  useChatSessionSummary,
  useDeleteSessionMutation,
  useUpdateSessionMutation,
} from "@/hooks/use-resource-mutations";
import { navHrefForPage } from "@/lib/navigation";
import { welcomeAnimationKey } from "@/pages/chat/chat-page.shared";

/**
 * Applied straight to the column rather than as an overlay child, so nothing
 * has to be lifted out of the way with z-index. It follows the app theme: a
 * pale indigo glow in light mode, the near-black one in dark mode.
 */
const COGNITO_SURFACE =
  "bg-[radial-gradient(125%_125%_at_50%_100%,#ffffff_40%,#dfe3ff_100%)] dark:bg-[radial-gradient(125%_125%_at_50%_100%,#000000_40%,#010133_100%)]";

/** Size of one dither pixel, in CSS pixels. */
const DITHER_CELL_PX = 4;

const DITHER_FRAME_MS = 1000 / 20;

/**
 * The canvas is drawn at a higher opacity than the idle pattern needs, so a
 * ripple can be brighter than the background. Idle pixels use a low alpha to
 * keep the old look.
 */
const DITHER_BASE_ALPHA = 32;

const RIPPLE_ALPHA = 255;

const RIPPLE_MS = 5000;

const RIPPLE_MAX = 6;

/** Clicks on these elements do their own job and do not touch the water. */
const RIPPLE_IGNORE =
  "button, a, input, textarea, select, label, [contenteditable='true'], [role='menu'], [role='listbox'], [role='dialog']";

interface Ripple {
  start: number;
  x: number;
  y: number;
}

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

/** Signed wave height at a point: rings that spread out and fade from each click. */
function rippleWave(
  x: number,
  y: number,
  aspect: number,
  t: number,
  ripples: Ripple[]
): number {
  let wave = 0;

  for (const ripple of ripples) {
    const age = (t - ripple.start) / RIPPLE_MS;

    if (age < 0 || age >= 1) {
      continue;
    }

    const distance = Math.hypot((x - ripple.x) * aspect, y - ripple.y);
    // Ease out, so the rings slow down as they spread, like real water.
    const phase = distance - (1 - (1 - age) ** 2) * 0.55;
    const envelope = Math.exp(-(phase * phase) / 0.006);
    wave += Math.cos(phase * 60) * envelope * (1 - age) ** 2;
  }

  return wave;
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
    let rippleImage = ctx.createImageData(1, 1);
    let ripples: Ripple[] = [];
    // The ripple is painted in a second colour, so it needs its own layer.
    const rippleLayer = document.createElement("canvas");
    const rippleCtx = rippleLayer.getContext("2d");

    const draw = (time: number) => {
      const { width, height, data } = image;
      const rippleData = rippleImage.data;
      const aspect = width / height;
      ripples = ripples.filter((ripple) => time - ripple.start < RIPPLE_MS);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const u = x / width;
          const v = y / height;
          const i = (y * width + x) * 4 + 3;
          const threshold = thresholds[(y % 8) * 8 + (x % 8)];

          const wave =
            ripples.length > 0 ? rippleWave(u, v, aspect, time, ripples) : 0;

          // The wave also bends the pattern under it, like light through water.
          const tone = ditherTone(
            u + wave * 0.025,
            v + wave * 0.025,
            aspect,
            time
          );

          // The ripple only moves water that is already there: where the
          // background has no shape, the rings fade out, so they follow its
          // outline instead of drawing a full circle.
          const surface = Math.min(1, tone * 3);
          const ripple = wave * surface;
          // One pattern, not two: crests raise the tone and troughs cut holes
          // in it, and lit pixels near a crest take the primary colour.
          const on = tone + ripple * 0.5 > threshold;
          const glow = Math.min(1, Math.max(0, ripple));
          const lit = on && glow > 0.15;

          data[i] = on && !lit ? DITHER_BASE_ALPHA : 0;
          rippleData[i] = lit ? RIPPLE_ALPHA * glow : 0;
        }
      }

      const style = getComputedStyle(canvas);

      ctx.globalCompositeOperation = "copy";
      ctx.putImageData(image, 0, 0);
      // Recolour the mask with the theme text colour, whatever format it is in.
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = style.color;
      ctx.fillRect(0, 0, width, height);

      if (!(rippleCtx && ripples.length > 0)) {
        return;
      }

      rippleCtx.globalCompositeOperation = "copy";
      rippleCtx.putImageData(rippleImage, 0, 0);
      rippleCtx.globalCompositeOperation = "source-in";
      rippleCtx.fillStyle = style.getPropertyValue("--primary").trim();
      rippleCtx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(rippleLayer, 0, 0);
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
      rippleLayer.width = canvas.width;
      rippleLayer.height = canvas.height;
      image = ctx.createImageData(canvas.width, canvas.height);
      rippleImage = ctx.createImageData(canvas.width, canvas.height);
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
      // Full frame rate while a ripple moves, so the rings do not stutter.
      if (ripples.length > 0 || time - last >= DITHER_FRAME_MS) {
        last = time;
        draw(time);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    const surface = canvas.parentElement;

    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(RIPPLE_IGNORE)
      ) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      ripples = [
        ...ripples.slice(-(RIPPLE_MAX - 1)),
        {
          start: performance.now(),
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        },
      ];
    };

    surface?.addEventListener("pointerdown", onPointerDown);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      surface?.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <canvas
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 size-full text-foreground opacity-[0.24] [image-rendering:pixelated] dark:opacity-[0.32]"
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
        cognito && COGNITO_SURFACE,
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

/**
 * Top bar of an open chat: its title, with rename, pin and delete behind it.
 * Desktop only, because on a phone the app header already shows the title.
 * Same height and rule as the attachment panel header, so the two line up.
 */
export function ChatSessionBar({
  actions,
  cognito,
  profileId,
  sessionId,
}: {
  actions?: ReactNode;
  cognito: boolean;
  profileId: string;
  sessionId: string;
}) {
  const navigate = useNavigate();
  const summary = useChatSessionSummary(profileId, sessionId);
  const updateSession = useUpdateSessionMutation();
  const deleteSession = useDeleteSessionMutation();
  const [renameTarget, setRenameTarget] = useState<SessionTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionTarget | null>(null);
  const title = summary?.title?.trim() || "New chat";
  const pinned = Boolean(summary?.pinned);

  return (
    <div className="-mx-6 flex h-14 shrink-0 items-center gap-2 border-border border-b px-4 max-sm:hidden">
      <div className="flex h-7 min-w-0 flex-1 items-center">
        {cognito ? (
          <h1 className="truncate px-2.5 font-medium text-sm">Cognito chat</h1>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="min-w-0 max-w-full justify-start"
                  size="sm"
                  variant="ghost"
                />
              }
            >
              <h1 className="truncate font-medium text-sm">{title}</h1>
              <ArrowDown01Icon
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => setRenameTarget({ id: sessionId, title })}
              >
                <PencilEdit02Icon aria-hidden="true" className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  updateSession.mutate({
                    input: { pinned: !pinned },
                    profileId,
                    sessionId,
                  })
                }
              >
                {pinned ? (
                  <PinOffIcon aria-hidden="true" className="size-4" />
                ) : (
                  <PinIcon aria-hidden="true" className="size-4" />
                )}
                {pinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteTarget({ id: sessionId, title })}
              >
                <Delete02Icon aria-hidden="true" className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {actions ? (
        <div className="flex h-7 shrink-0 items-center gap-1">{actions}</div>
      ) : null}
      <RecentChatsDialogs
        deleteTarget={deleteTarget}
        onDelete={async () => {
          await deleteSession.mutateAsync(sessionId);
          setDeleteTarget(null);
          navigate(navHrefForPage("chat", profileId), { replace: true });
        }}
        onRename={async (event) => {
          event.preventDefault();
          const next = renameTarget?.title.trim();

          if (!next || updateSession.isPending) {
            return;
          }

          await updateSession.mutateAsync({
            input: { title: next },
            profileId,
            sessionId,
          });
          setRenameTarget(null);
        }}
        onRenameTitleChange={(next) =>
          setRenameTarget((current) =>
            current ? { ...current, title: next } : current
          )
        }
        renameTarget={renameTarget}
        setDeleteTarget={setDeleteTarget}
        setRenameTarget={setRenameTarget}
      />
    </div>
  );
}
