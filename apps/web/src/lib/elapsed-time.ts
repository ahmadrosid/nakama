import { useEffect, useRef, useState } from "react";

export function elapsedSecondsSince(anchorMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - anchorMs) / 1000));
}

export function formatElapsedSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

export function useElapsedSeconds(active: boolean, startedAt?: string): number {
  const anchorRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      setElapsed(0);
      return;
    }

    if (anchorRef.current === null) {
      const parsed = startedAt ? new Date(startedAt).getTime() : Number.NaN;
      anchorRef.current = Number.isNaN(parsed) ? Date.now() : parsed;
    }

    const update = () => {
      setElapsed(elapsedSecondsSince(anchorRef.current!, Date.now()));
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [active, startedAt]);

  return elapsed;
}
