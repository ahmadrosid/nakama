import { toast } from "@nakama/ui/toast";
import { useEffect, useRef, useState } from "react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input-context";
import { client, formatError } from "@/lib/client";
import { readFileAsDataUrl } from "@/lib/read-file-as-data-url";

export type DictationState = "idle" | "recording" | "transcribing";

const MAX_RECORDING_MS = 60_000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );
}

function extensionFor(mediaType: string): string {
  if (mediaType.includes("mp4")) {
    return "m4a";
  }

  if (mediaType.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

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
  const maxTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
  };

  useEffect(
    () => () => {
      mountedRef.current = false;

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
      onActiveChangeRef.current?.(false);

      return;
    }

    setState("transcribing");

    try {
      const mediaType = mimeType.split(";")[0] || "audio/webm";
      const data = (await readFileAsDataUrl(blob)).split(",")[1] ?? "";

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
        // was pending, and that text must be preserved. The controller
        // ref tracks the latest render's API, which already holds the
        // live draft value.
        const liveController = controllerRef.current;
        const current = liveController.textInput.value;

        liveController.textInput.setInput(
          current.trim() ? `${current.trimEnd()} ${trimmed}` : trimmed
        );
      }
    } catch (error) {
      if (session === sessionRef.current) {
        toast(`Transcription failed: ${formatError(error)}`);
      }
    } finally {
      if (session === sessionRef.current) {
        setState("idle");
        onActiveChangeRef.current?.(false);
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

    if (startingRef.current) {
      return;
    }

    startingRef.current = true;

    try {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast(
          "Microphone access was blocked. Allow microphone permission for this site and try again."
        );

        return;
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });

        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      discardRef.current = false;
      const session = ++sessionRef.current;

      const mimeType = pickMimeType();

      try {
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
            onActiveChangeRef.current?.(false);

            return;
          }

          void finishRecording(blob, recorder.mimeType, session);
        };

        recorderRef.current = recorder;
        recorder.start();
      } catch {
        recorderRef.current = null;
        stopStream();
        toast("Voice recording could not start in this browser.");

        return;
      }

      startedAtRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      onActiveChangeRef.current?.(true);
      waveform.startWaveform(stream);
      tickRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      maxTimerRef.current = window.setTimeout(() => {
        recorderRef.current?.stop();
      }, MAX_RECORDING_MS);
    } finally {
      startingRef.current = false;
    }
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

const MAX_BARS = 56;

/** Live waveform for the recording bar: RMS samples drawn on a canvas. */
export function useDictationWaveform() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const barsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const colorRef = useRef<string | null>(null);
  const samplesRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  const stopWaveform = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }

    analyserRef.current = null;
    barsRef.current = [];
    canvasElRef.current = null;
    ctxRef.current = null;
    colorRef.current = null;
    samplesRef.current = null;
  };

  const drawWaveform = () => {
    // Reschedule first: the canvas only mounts after the recording state
    // renders, so early frames must keep the loop alive until it appears.
    rafRef.current = requestAnimationFrame(drawWaveform);

    const canvas = canvasRef.current;
    const analyser = analyserRef.current;

    if (!(canvas && analyser)) {
      return;
    }

    // Cache the context and fill colour per canvas element: both are
    // stable for a mounted canvas, and getComputedStyle forces a style
    // recalc on every call. (The canvas mounts after recording starts,
    // so the cache fills lazily on the first frame that sees it.)
    if (canvasElRef.current !== canvas) {
      canvasElRef.current = canvas;
      ctxRef.current = canvas.getContext("2d");
      colorRef.current = getComputedStyle(canvas).color;
    }

    const ctx = ctxRef.current;

    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * dpr;
    const height = canvas.clientHeight * dpr;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colorRef.current ?? "";

    const now = performance.now();

    if (now - lastSampleRef.current >= 55) {
      lastSampleRef.current = now;

      if (
        samplesRef.current === null ||
        samplesRef.current.length !== analyser.fftSize
      ) {
        samplesRef.current = new Float32Array(analyser.fftSize);
      }

      const samples = samplesRef.current;

      analyser.getFloatTimeDomainData(samples);

      let sum = 0;

      for (const sample of samples) {
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / samples.length);

      barsRef.current.push(Math.min(1, rms * 3.2));

      if (barsRef.current.length > MAX_BARS) {
        barsRef.current.shift();
      }
    }

    const bars = barsRef.current;
    const barWidth = 3.5 * dpr;
    const gap = 2.5 * dpr;
    const step = barWidth + gap;
    const maxBarsVisible = Math.max(1, Math.floor(width / step));
    const visible = bars.slice(-maxBarsVisible);
    const mid = height / 2;

    visible.forEach((level, index) => {
      const barHeight = Math.max(2 * dpr, level * height * 0.92);
      const x = width - (visible.length - index) * step + gap / 2;

      ctx.beginPath();
      ctx.roundRect(x, mid - barHeight / 2, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    });
  };

  const startWaveform = (stream: MediaStream) => {
    // SAFETY: webkitAudioContext is the legacy Safari name for AudioContext; it is
    // only read when window.AudioContext is absent, and the result is null-checked
    // before use.
    const AudioCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioCtor) {
      return;
    }

    try {
      const audioCtx = new AudioCtor();
      const analyser = audioCtx.createAnalyser();

      analyser.fftSize = 2048;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      barsRef.current = [];
      lastSampleRef.current = 0;
      void audioCtx.resume();
      rafRef.current = requestAnimationFrame(drawWaveform);
    } catch {
      // Waveform is decorative; recording continues without it.
    }
  };

  return { canvasRef, startWaveform, stopWaveform };
}
