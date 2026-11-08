import { useEffect, useState } from "react";

/**
 * Tracks the OS motion preference and follows changes while mounted.
 * Starts true so the first paint does not animate before the pref is known.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}
