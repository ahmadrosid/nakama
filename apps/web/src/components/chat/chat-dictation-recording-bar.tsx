import { Button } from "@nakama/ui/button";
import { cn } from "@nakama/ui/utils";
import { ArrowUp02Icon, Delete02Icon } from "hugeicons-react";
import type { RefObject } from "react";
import {
  composerHitTargetClass,
  composerIconButtonClass,
} from "@/lib/chat-stream";
import { formatElapsed } from "./chat-dictation-audio";

/** Recording bar shown while dictation is capturing audio. */
export function DictationRecordingBar({
  canvasRef,
  elapsed,
  onDiscard,
  onSend,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  elapsed: number;
  onDiscard: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <Button
        aria-label="Discard recording"
        className={cn(
          composerIconButtonClass,
          "size-8 bg-transparent text-muted-foreground hover:bg-muted hover:text-destructive"
        )}
        onClick={onDiscard}
        size="icon-sm"
        title="Discard recording"
        type="button"
        variant="ghost"
      >
        <Delete02Icon className="size-4" />
      </Button>

      <span className="flex items-center gap-1.5">
        <span className="size-2 animate-pulse rounded-full bg-destructive" />
        <span className="min-w-8 text-sm tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </span>

      <canvas className="h-8 w-24 text-primary sm:w-44" ref={canvasRef} />

      <Button
        aria-label="Send voice"
        className={cn(
          composerHitTargetClass,
          "size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-[color,background-color,transform,opacity] hover:bg-primary/90 active:scale-[0.96]"
        )}
        onClick={onSend}
        size="icon-sm"
        title="Send voice"
        type="button"
      >
        <ArrowUp02Icon className="size-4" />
      </Button>
    </div>
  );
}
