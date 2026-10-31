import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp02Icon, Delete02Icon, Mic01Icon } from "hugeicons-react";
import type { RefObject } from "react";
import {
  composerHitTargetClass,
  composerIconButtonClass,
} from "@/lib/chat-stream";
import { client } from "@/lib/client";
import { formatElapsedSeconds } from "@/lib/elapsed-time";
import {
  useDictationRecorder,
  useDictationWaveform,
} from "./use-dictation-recorder";

/**
 * Microphone dictation for the chat composer, mirroring the Ragbot voice
 * bar: while recording it shows discard, an elapsed timer, a live waveform
 * and a send button. Audio goes to the built-in /v1/audio/transcribe
 * endpoint and the returned text is inserted into the composer input
 * (existing text is kept).
 */
export function ChatDictationButton({
  disabled,
  onActiveChange,
}: {
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const waveform = useDictationWaveform();
  const recorder = useDictationRecorder({ onActiveChange, waveform });

  const { data: transcriptionSettings } = useQuery({
    queryFn: () => client.getTranscriptionSettings(),
    queryKey: ["transcription-settings"],
    retry: false,
    staleTime: 60_000,
  });

  // Dictation only makes sense when the instance has a transcription
  // model configured; hide the affordance entirely otherwise.
  if (!transcriptionSettings?.model) {
    return null;
  }

  if (recorder.state === "recording") {
    return (
      <DictationRecordingBar
        canvasRef={waveform.canvasRef}
        elapsed={recorder.elapsed}
        onDiscard={recorder.discardRecording}
        onSend={recorder.sendRecording}
      />
    );
  }

  if (recorder.state === "transcribing") {
    return (
      <span className="flex h-8 items-center gap-2 px-1 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        Transcribing…
      </span>
    );
  }

  return (
    <Button
      aria-label="Dictate with microphone"
      className={cn(
        composerIconButtonClass,
        "size-8 bg-transparent text-foreground hover:bg-muted"
      )}
      disabled={disabled}
      onClick={() => void recorder.startRecording()}
      ref={recorder.buttonRef}
      size="icon-sm"
      title="Dictate with microphone"
      type="button"
      variant="ghost"
    >
      <Mic01Icon className="size-4" />
    </Button>
  );
}

/** Recording bar shown while dictation is capturing audio. */
function DictationRecordingBar({
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
          {formatElapsedSeconds(elapsed)}
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
