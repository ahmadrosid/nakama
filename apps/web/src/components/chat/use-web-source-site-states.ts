import { useEffect, useRef, useState } from "react";
import type { WebSearchSiteState } from "@/components/chat/web-search.shared";

const STAGGER_LOADING_MS = 150;
const STAGGER_DONE_MS = 400;
const STAGGER_TICK_MS = 50;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function buildInitialSiteStates(
  count: number,
  status: "running" | "done",
  reducedMotion: boolean,
): WebSearchSiteState[] {
  if (count === 0) {
    return [];
  }

  if (status === "running" || reducedMotion) {
    return Array.from({ length: count }, () => (status === "done" ? "done" : "pending"));
  }

  return Array.from({ length: count }, () => "pending");
}

function siteStateAtElapsed(index: number, elapsed: number): WebSearchSiteState {
  const loadingAt = STAGGER_LOADING_MS * (index + 1);
  const doneAt = loadingAt + STAGGER_DONE_MS;
  if (elapsed >= doneAt) {
    return "done";
  }
  if (elapsed >= loadingAt) {
    return "loading";
  }
  return "pending";
}

export function useWebSourceSiteStates(
  sourceCount: number,
  status: "running" | "done",
): WebSearchSiteState[] {
  const reducedMotion = usePrefersReducedMotion();
  const [siteStates, setSiteStates] = useState<WebSearchSiteState[]>(() =>
    buildInitialSiteStates(sourceCount, status, reducedMotion),
  );
  const staggerRunRef = useRef(0);

  useEffect(() => {
    if (status === "running") {
      setSiteStates(buildInitialSiteStates(sourceCount, "running", reducedMotion));
      return;
    }

    if (sourceCount === 0) {
      setSiteStates([]);
      return;
    }

    if (reducedMotion) {
      setSiteStates(Array.from({ length: sourceCount }, () => "done"));
      return;
    }

    const runId = staggerRunRef.current + 1;
    staggerRunRef.current = runId;
    const startedAt = Date.now();
    const finishAt = STAGGER_LOADING_MS * sourceCount + STAGGER_DONE_MS;

    setSiteStates(Array.from({ length: sourceCount }, () => "pending"));

    const intervalId = setInterval(() => {
      if (staggerRunRef.current !== runId) {
        return;
      }

      const elapsed = Date.now() - startedAt;
      setSiteStates(
        Array.from({ length: sourceCount }, (_, index) => siteStateAtElapsed(index, elapsed)),
      );

      if (elapsed >= finishAt) {
        clearInterval(intervalId);
      }
    }, STAGGER_TICK_MS);

    return () => clearInterval(intervalId);
  }, [reducedMotion, sourceCount, status]);

  return siteStates;
}
