import { cn } from "@nakama/ui/utils";
import {
  getMentionTokenRanges,
  type SkillTokenRange,
} from "@/lib/chat-composer-skills";

interface ChatSkillTokenOverlayProps {
  className?: string;
  /** Tokens to highlight; defaults to the chat composer's built-in mentions. */
  ranges?: SkillTokenRange[];
  /** The textarea's scroll offset, so highlights stay under their text. */
  scrollTop?: number;
  value: string;
}

export function ChatSkillTokenOverlay({
  value,
  className,
  ranges,
  scrollTop,
}: ChatSkillTokenOverlayProps) {
  const tokenRanges = ranges ?? getMentionTokenRanges(value);

  if (tokenRanges.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
        className
      )}
    >
      {scrollTop ? (
        <div style={{ transform: `translateY(${-scrollTop}px)` }}>
          {renderHighlightedValue(value, tokenRanges)}
        </div>
      ) : (
        renderHighlightedValue(value, tokenRanges)
      )}
    </div>
  );
}

function renderHighlightedValue(value: string, tokenRanges: SkillTokenRange[]) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const token of tokenRanges) {
    if (token.start > cursor) {
      parts.push(value.slice(cursor, token.start));
    }

    parts.push(
      <span
        className="rounded bg-primary/10 ring-1 ring-primary/20"
        key={`${token.start}:${token.end}`}
      >
        {value.slice(token.start, token.end)}
      </span>
    );
    cursor = token.end;
  }

  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }

  return parts;
}
