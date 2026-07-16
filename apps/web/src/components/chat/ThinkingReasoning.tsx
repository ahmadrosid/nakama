import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ThinkingReasoning.module.css";
import { ThinkingState } from "@/components/chat/ThinkingState";
import { splitThinkingLines } from "@/lib/thinking-text";
import { cn } from "@/lib/utils";

const MAX_H = 100;
const COLLAPSE_BEAT = 360;

export interface ThinkingReasoningProps {
  text: string;
  isThinkingStreaming: boolean;
  isWorkActive: boolean;
  startedAt?: string;
  className?: string;
  children?: ReactNode;
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
      setElapsed(Math.max(1, Math.floor((Date.now() - anchorRef.current!) / 1000)));
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
  const [fade, setFade] = useState({ top: false, bottom: false });

  const updateFade = () => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const overflows = element.scrollHeight > element.clientHeight + 1;
    if (!overflows) {
      setFade({ top: false, bottom: false });
      return;
    }

    setFade({
      top: element.scrollTop > 1,
      bottom: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
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

  if (sentences.length === 0) {
    return null;
  }

  const mask =
    fade.top || fade.bottom
      ? `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? 12 : 0}px, #000 calc(100% - ${fade.bottom ? 12 : 0}px), transparent 100%)`
      : undefined;

  return (
    <div
      ref={viewportRef}
      className={cn(styles.viewport, styles.viewportScroll)}
      style={{
        maxHeight: `${MAX_H}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
      onScroll={handleScroll}
    >
      <div className={styles.stream}>
        {sentences.map((line, index) => (
          <p key={`${index}:${line}`} className={styles.sentence}>
            {line}
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
  const trimmed = text.trim();
  const sentences = useMemo(() => splitThinkingLines(text), [text]);
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

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  if (!hasBody && !isWorkActive) {
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
    <div
      className={cn(
        styles.root,
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          styles.header,
          done && styles.headerClickable,
          expanded && styles.headerExpanded,
        )}
        aria-expanded={expanded}
        aria-label="Toggle thought"
        onClick={() => done && toggle()}
      >
        {done ? (
          <span className={styles.label}>
            <span className={styles.verb}>Thought</span> for {elapsedSeconds}s
          </span>
        ) : (
          <span className={cn(styles.label, styles.shimmer)}>Thinking…</span>
        )}
        {done ? (
          <svg
            className={styles.chevron}
            viewBox="0 0 24 24"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      <div className={cn(styles.collapsible, !expanded && styles.collapsibleCollapsed)}>
        <div className={styles.inner}>
          {showTimeline ? (
            <div className={styles.timeline}>
              {sentences.length > 0 ? (
                <ThinkingReasoningViewport
                  sentences={sentences}
                  isWorkActive={isWorkActive}
                />
              ) : null}
              {children ? (
                <div
                  className={cn(styles.tools, sentences.length > 0 && styles.toolsAfterReasoning)}
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
