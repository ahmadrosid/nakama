import type { SkillSummary } from "@nakama/core/contract";
import { getSkillTokenRanges, type SkillTokenRange } from "@/lib/chat-composer-skills";
import { cn } from "@/lib/utils";

interface ChatSkillTokenOverlayProps {
  value: string;
  skills: SkillSummary[];
  className?: string;
}

export function ChatSkillTokenOverlay({
  value,
  skills,
  className,
}: ChatSkillTokenOverlayProps) {
  const tokenRanges = getSkillTokenRanges(value).filter((range) =>
    skills.some((skill) => skill.name === range.name),
  );

  if (tokenRanges.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
        className,
      )}
    >
      {renderHighlightedValue(value, tokenRanges)}
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
        key={`${token.start}:${token.end}`}
        className="rounded bg-primary/10 ring-1 ring-primary/20"
      >
        {value.slice(token.start, token.end)}
      </span>,
    );
    cursor = token.end;
  }

  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }

  return parts;
}
