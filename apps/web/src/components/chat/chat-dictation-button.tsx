import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { Mic01Icon } from "hugeicons-react";
import { composerIconButtonClass } from "@/lib/chat-stream";
import { client } from "@/lib/client";
import { DictationRecordingBar } from "./chat-dictation-recording-bar";
import { useDictationRecorder } from "./use-dictation-recorder";
import { useDictationWaveform } from "./use-dictation-waveform";

/**
 * Microphone dictation for the chat composer, mirroring the Ragbot voice
 * bar: while recording it shows discard, an m:ss timer, a live waveform
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
