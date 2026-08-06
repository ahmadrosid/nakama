import { useEffect, useRef, useState } from "react";

/**
 * While `enabled`, propagates `value` at most once per animation frame.
 * When disabled, returns `value` immediately (catch-up on stream end).
 */
export function useRafCoalescedValue<T>(value: T, enabled: boolean): T {
  const [display, setDisplay] = useState(value);
  const pendingRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      generationRef.current += 1;
      if (rafRef.current != null && rafRef.current >= 0 && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      pendingRef.current = value;
      return;
    }

    pendingRef.current = value;
    if (rafRef.current != null) {
      return;
    }

    const generation = generationRef.current;
    const run = () => {
      if (generation !== generationRef.current) {
        return;
      }
      rafRef.current = null;
      setDisplay(pendingRef.current);
    };

    if (typeof requestAnimationFrame === "function") {
      rafRef.current = requestAnimationFrame(run);
      return;
    }

    // Mark scheduled without rAF so bursts in this turn still coalesce.
    rafRef.current = -1;
    queueMicrotask(() => {
      if (rafRef.current !== -1) {
        return;
      }
      run();
    });
  }, [value, enabled]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (rafRef.current != null && rafRef.current >= 0 && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    };
  }, []);

  return enabled ? display : value;
}
