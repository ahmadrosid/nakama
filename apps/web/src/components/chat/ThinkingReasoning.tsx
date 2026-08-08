import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThinkingState } from "@/components/chat/ThinkingState";
import { useRafCoalescedValue } from "@/hooks/use-raf-coalesced-value";
import { formatElapsedSeconds } from "@/lib/elapsed-time";
import { splitThinkingLines } from "@/lib/thinking-text";
import { cn } from "@/lib/utils";
import styles from "./ThinkingReasoning.module.css";

const MAX_H = 100;
const COLLAPSE_BEAT = 360;

export interface ThinkingReasoningProps {
  children?: ReactNode;
  className?: string;
  isThinkingStreaming: boolean;
  isWorkActive: boolean;
  startedAt?: string;
  text: string;
}

function useThinkingElapsed(isWorkActive: boolean, startedAt?: string): number {
  const anchorRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(1);

  useEffect(() => {
    if (!isWorkActive) {
      return;
    }

    if (anchorRef.current === null) {
      const parsed = startedAt ? new Date(startedAt).getTime() : Number.NaN;
      anchorRef.current = Number.isNaN(parsed) ? Date.now() : parsed;
    }

    const update = () => {
      setElapsed(
        Math.max(1, Math.floor((Date.now() - anchorRef.current!) / 1000))
      );
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [isWorkActive, startedAt]);

  return elapsed;
}

function ThinkingReasoningViewport({
  sentences,
  isWorkActive,
}: {
  sentences: string[];
  isWorkActive: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState({ bottom: false, top: false });

  // Append-only stream: sealed lines keep a content-prefix key; the live tail
  // keeps a fixed key so growing text does not remount / re-fade.
  const items = useMemo(() => {
    let sealedPrefix = "";
    return sentences.map((text, index) => {
      const isLiveTail = isWorkActive && index === sentences.length - 1;
      if (isLiveTail) {
        return { fresh: true as const, key: "live-tail", text };
      }
      sealedPrefix = `${sealedPrefix}\0${text}`;
      return { fresh: false as const, key: `sealed:${sealedPrefix}`, text };
    });
  }, [sentences, isWorkActive]);

  const updateFade = () => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const overflows = element.scrollHeight > element.clientHeight + 1;
    if (!overflows) {
      setFade({ bottom: false, top: false });
      return;
    }

    setFade({
      bottom:
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      top: element.scrollTop > 1,
    });
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    if (isWorkActive) {
      element.scrollTop = element.scrollHeight;
    }

    const frameId = window.requestAnimationFrame(() => {
      updateFade();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [sentences, isWorkActive]);

  const handleScroll = () => {
    updateFade();
  };

  if (items.length === 0) {
    return null;
  }

  const mask =
    fade.top || fade.bottom
      ? `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? 12 : 0}px, #000 calc(100% - ${fade.bottom ? 12 : 0}px), transparent 100%)`
      : undefined;

  return (
    <div
      className={cn(styles.viewport, styles.viewportScroll)}
      onScroll={handleScroll}
      ref={viewportRef}
      style={{
        maskImage: mask,
        maxHeight: `${MAX_H}px`,
        WebkitMaskImage: mask,
      }}
    >
      <div className={styles.stream}>
        {items.map((item) => (
          <p
            className={styles.sentence}
            data-fresh={item.fresh || undefined}
            key={item.key}
          >
            {item.text}
          </p>
        ))}
      </div>
    </div>
  );
}

export function ThinkingReasoning({
  text,
  isThinkingStreaming,
  isWorkActive,
  startedAt,
  className,
  children,
}: ThinkingReasoningProps) {
  const displayText = useRafCoalescedValue(text, isThinkingStreaming);
  const trimmed = displayText.trim();
  const sentences = useMemo(
    () => splitThinkingLines(displayText),
    [displayText]
  );
  const hasBody = sentences.length > 0 || Boolean(children);
  const elapsedSeconds = useThinkingElapsed(isWorkActive, startedAt);
  const [done, setDone] = useState(!isWorkActive && hasBody);
  const [open, setOpen] = useState(isWorkActive);

  useEffect(() => {
    if (isWorkActive) {
      setDone(false);
      setOpen(true);
      return;
    }

    if (!hasBody) {
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const delay = reducedMotion ? 0 : COLLAPSE_BEAT;
    const timerId = window.setTimeout(() => {
      setDone(true);
      setOpen(false);
    }, delay);

    return () => window.clearTimeout(timerId);
  }, [hasBody, isWorkActive]);

  if (isWorkActive && isThinkingStreaming && !trimmed && !children) {
    return <ThinkingState className={className} />;
  }

  if (!(hasBody || isWorkActive)) {
    return null;
  }

  const expanded = done ? open : true;
  const showTimeline = sentences.length > 0 || Boolean(children);

  const toggle = () => {
    if (!done) {
      return;
    }
    setOpen((current) => !current);
  };

  return (
    <div className={cn(styles.root, className)}>
      <button
        aria-expanded={expanded}
        aria-label="Toggle thought"
        className={cn(
          styles.header,
          done && styles.headerClickable,
          expanded && styles.headerExpanded
        )}
        onClick={() => done && toggle()}
        type="button"
      >
        {done ? (
          <span className={styles.label}>
            <span className={styles.verb}>Thought</span> for {elapsedSeconds}s
          </span>
        ) : (
          <span className={cn(styles.label, styles.shimmer)}>
            {children && !isThinkingStreaming
              ? `Working… · ${formatElapsedSeconds(elapsedSeconds)}`
              : "Thinking…"}
          </span>
        )}
        {done ? (
          <svg
            aria-hidden="true"
            className={styles.chevron}
            height="12"
            viewBox="0 0 24 24"
            width="12"
          >
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        ) : null}
      </button>

      <div
        className={cn(
          styles.collapsible,
          !expanded && styles.collapsibleCollapsed
        )}
      >
        <div className={styles.inner}>
          {showTimeline ? (
            <div className={styles.timeline}>
              {sentences.length > 0 ? (
                <ThinkingReasoningViewport
                  isWorkActive={isWorkActive}
                  sentences={sentences}
                />
              ) : null}
              {children ? (
                <div
                  className={cn(
                    styles.tools,
                    sentences.length > 0 && styles.toolsAfterReasoning
                  )}
                >
                  {children}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
