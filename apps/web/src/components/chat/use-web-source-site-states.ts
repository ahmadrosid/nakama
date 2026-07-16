import { useEffect, useRef, useState } from "react";
import type { WebSearchSiteState } from "@/components/chat/web-search.shared";

const STAGGER_LOADING_MS = 150;
const STAGGER_DONE_MS = 400;

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
    const timers: ReturnType<typeof setTimeout>[] = [];

    setSiteStates(Array.from({ length: sourceCount }, () => "pending"));

    for (let index = 0; index < sourceCount; index += 1) {
      timers.push(
        setTimeout(() => {
          if (staggerRunRef.current !== runId) {
            return;
          }

          setSiteStates((current) =>
            current.map((value, currentIndex) =>
              currentIndex === index ? "loading" : value,
            ),
          );
        }, STAGGER_LOADING_MS * (index + 1)),
      );

      timers.push(
        setTimeout(() => {
          if (staggerRunRef.current !== runId) {
            return;
          }

          setSiteStates((current) =>
            current.map((value, currentIndex) =>
              currentIndex === index ? "done" : value,
            ),
          );
        }, STAGGER_LOADING_MS * (index + 1) + STAGGER_DONE_MS),
      );
    }

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [reducedMotion, sourceCount, status]);

  return siteStates;
}
