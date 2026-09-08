import type { ChatUsage } from "@nakama/core/contract";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type ChatContextUsage,
  contextUsageRatio,
  contextUsageSegments,
  formatBytes,
  formatContextUsageLabel,
  formatTokenCountDetailed,
} from "@/lib/chat-context-usage";
import { formatChatUsage } from "@/lib/chat-usage";
import { cn } from "@/lib/utils";

/** Match BrainIcon / select chevron visual weight in the composer toolbar. */
const RING_SIZE = 12;
const STROKE_WIDTH = 1.75;

function progressStrokeClass(ratio: number): string {
  if (ratio >= 0.9) {
    return "stroke-destructive";
  }

  if (ratio >= 0.75) {
    return "stroke-amber-500";
  }

  return "stroke-muted-foreground";
}

export function ChatContextUsageRing({
  usage,
  sessionUsage,
  className,
}: {
  usage: ChatContextUsage;
  /** Session token total, folded in here rather than shown beside the ring. */
  sessionUsage?: ChatUsage | null;
  className?: string;
}) {
  const ratio = contextUsageRatio(usage);
  const percent = Math.round(ratio * 100);
  const radius = (RING_SIZE - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  const label = formatContextUsageLabel(usage);
  const sessionLabel = sessionUsage
    ? `Session · ${formatChatUsage(sessionUsage)}`
    : null;
  const segments = contextUsageSegments(usage);
  const segmentTotal = segments.reduce(
    (sum, segment) => sum + segment.tokens,
    0
  );
  const fillRatio = ratio;
  const optimizedNote =
    usage.bytesKeptOut && usage.bytesProduced
      ? `${formatBytes(usage.bytesKeptOut)} of tool output saved (${Math.round((100 * usage.bytesKeptOut) / usage.bytesProduced)}%)`
      : null;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={sessionLabel ? `${label} · ${sessionLabel}` : label}
            className={cn(
              "inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              className
            )}
            type="button"
          >
            <svg
              aria-hidden
              className="-rotate-90"
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              width={RING_SIZE}
            >
              <circle
                className="stroke-muted-foreground/25"
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                fill="none"
                r={radius}
                strokeWidth={STROKE_WIDTH}
              />
              <circle
                className={cn(
                  "transition-[stroke-dashoffset,stroke] duration-300",
                  progressStrokeClass(ratio)
                )}
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                fill="none"
                r={radius}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                strokeWidth={STROKE_WIDTH}
              />
            </svg>
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="w-80 min-w-80 p-3.5"
        side="top"
        sideOffset={8}
      >
        <PopoverHeader title="Context Usage" />

        <div className="mb-2 flex items-baseline justify-between gap-3 text-muted-foreground text-xs">
          <span>{percent}% Full</span>
          <span>
            ~{formatTokenCountDetailed(usage.usedTokens)} /{" "}
            {formatTokenCountDetailed(usage.usableContextTokens)} Tokens
          </span>
        </div>

        <div
          aria-hidden
          className="mb-3 flex h-1.5 overflow-hidden rounded-full bg-muted"
        >
          {segments.map((segment) => (
            <div
              className={cn("h-full min-w-px", segment.colorClass)}
              key={segment.id}
              style={{
                width: `${
                  segmentTotal > 0 && fillRatio > 0
                    ? (segment.tokens / segmentTotal) * fillRatio * 100
                    : 0
                }%`,
              }}
            />
          ))}
        </div>

        <ul className="flex flex-col gap-2 text-sm">
          {segments.map((segment) => (
            <li
              className="flex items-center justify-between gap-3"
              key={segment.id}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-[3px]",
                    segment.colorClass
                  )}
                />
                <span className="truncate">{segment.label}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokenCountDetailed(segment.tokens)}
              </span>
            </li>
          ))}
        </ul>

        {usage.source === "estimate" || sessionLabel || optimizedNote ? (
          <div className="mt-3 space-y-1 text-muted-foreground text-xs">
            {usage.source === "estimate" ? (
              <p>Estimated from prompt size</p>
            ) : null}
            {sessionLabel ? <p>{sessionLabel}</p> : null}
            {optimizedNote ? <p>{optimizedNote}</p> : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
