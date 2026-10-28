import { toast } from "@nakama/ui/toast";
import { useEffect, useRef, useState } from "react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input-context";
import { client, formatError } from "@/lib/client";
import {
  blobToBase64,
  extensionFor,
  pickMimeType,
} from "./chat-dictation-audio";

export type DictationState = "idle" | "recording" | "transcribing";

const MAX_RECORDING_MS = 60_000;

/**
 * Owns the dictation recording lifecycle: mic capture, the 60-second
 * cap, the per-recording session token, and the transcription call.
 * A result only ever reaches the draft while its session token is still
 * active; a discard, a new recording, or unmount invalidates it.
 */
export function useDictationRecorder({
  onActiveChange,
  waveform,
}: {
  onActiveChange?: (active: boolean) => void;
  waveform: {
    startWaveform: (stream: MediaStream) => void;
    stopWaveform: () => void;
  };
}) {
  const controller = usePromptInputController();
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  });
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  });
  const waveformRef = useRef(waveform);
  useEffect(() => {
    waveformRef.current = waveform;
  });

  const [state, setState] = useState<DictationState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const sessionRef = useRef(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
  };

  useEffect(
    () => () => {
      if (maxTimerRef.current !== null) {
        window.clearTimeout(maxTimerRef.current);
      }

      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
      }

      discardRef.current = true;
      sessionRef.current += 1;
      recorderRef.current?.stop();
      waveformRef.current.stopWaveform();
      stopStream();
    },
    []
  );

  useEffect(
    () => () => {
      onActiveChangeRef.current?.(false);
    },
    []
  );

  const finishRecording = async (
    blob: Blob,
    mimeType: string,
    session: number
  ) => {
    if (blob.size === 0) {
      setState("idle");
      onActiveChange?.(false);

      return;
    }

    setState("transcribing");

    try {
      const mediaType = mimeType.split(";")[0] ?? "audio/webm";
      const data = await blobToBase64(blob);

      const { text } = await client.transcribeAudio({
        data,
        filename: `dictation.${extensionFor(mediaType)}`,
        mediaType,
      });
      // A late result may only write to the draft if this recording
      // session is still the active one: a discard, a new recording, or
      // leaving the chat invalidates the token, and the result is
      // dropped instead of touching any draft.

      if (session !== sessionRef.current) {
        return;
      }

      const trimmed = text.trim();

      if (trimmed) {
        // Read the draft as it is NOW, not as it was when recording
        // started: the user may have kept typing while transcription
        // was pending, and that text must be preserved. The textarea
        // holds the live value; the controller ref tracks the latest
        // render's API.
        const liveController = controllerRef.current;
        const textarea = formRef.current?.querySelector("textarea");
        const current = textarea?.value ?? liveController.textInput.value;

        liveController.textInput.setInput(
          current.trim() ? `${current.trimEnd()} ${trimmed}` : trimmed
        );
        textarea?.focus();
      }
    } catch (error) {
      if (session === sessionRef.current) {
        toast(`Transcription failed: ${formatError(error)}`);
      }
    } finally {
      if (session === sessionRef.current) {
        setState("idle");
        onActiveChange?.(false);
      }
    }
  };

  const startRecording = async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast(
        "Voice input is not available here. Open this page over HTTPS in a modern browser."
      );

      return;
    }

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast(
        "Microphone access was blocked. Allow microphone permission for this site and try again."
      );

      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;
    const session = ++sessionRef.current;
    formRef.current = buttonRef.current?.closest("form") ?? null;

    const mimeType = pickMimeType();

    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      if (maxTimerRef.current !== null) {
        window.clearTimeout(maxTimerRef.current);
        maxTimerRef.current = null;
      }

      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      const discard = discardRef.current;

      chunksRef.current = [];
      recorderRef.current = null;
      waveform.stopWaveform();
      stopStream();

      if (discard) {
        setState("idle");
        onActiveChange?.(false);

        return;
      }

      void finishRecording(blob, recorder.mimeType, session);
    };

    recorderRef.current = recorder;
    recorder.start();
    startedAtRef.current = Date.now();
    setElapsed(0);
    setState("recording");
    onActiveChange?.(true);
    waveform.startWaveform(stream);
    tickRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    maxTimerRef.current = window.setTimeout(() => {
      recorderRef.current?.stop();
    }, MAX_RECORDING_MS);
  };

  const discardRecording = () => {
    discardRef.current = true;
    recorderRef.current?.stop();
  };

  const sendRecording = () => {
    recorderRef.current?.stop();
  };

  return {
    buttonRef,
    discardRecording,
    elapsed,
    sendRecording,
    startRecording,
    state,
  };
}
