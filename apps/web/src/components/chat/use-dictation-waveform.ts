import { useRef } from "react";

const MAX_BARS = 56;

/** Live waveform for the recording bar: RMS samples drawn on a canvas. */
export function useDictationWaveform() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const barsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);

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

    const now = performance.now();

    if (now - lastSampleRef.current >= 55) {
      lastSampleRef.current = now;
      const samples = new Float32Array(analyser.fftSize);

      analyser.getFloatTimeDomainData(samples);

      let sum = 0;

      for (const sample of samples) {
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / samples.length);

      barsRef.current = [...barsRef.current, Math.min(1, rms * 3.2)].slice(
        -MAX_BARS
      );
    }

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * dpr;
    const height = canvas.clientHeight * dpr;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(canvas).color;

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
