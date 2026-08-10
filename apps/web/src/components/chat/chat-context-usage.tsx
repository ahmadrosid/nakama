import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type ChatContextUsage,
  contextUsageRatio,
  formatContextUsageLabel,
} from "@/lib/chat-context-usage";
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
  className,
}: {
  usage: ChatContextUsage;
  className?: string;
}) {
  const ratio = contextUsageRatio(usage);
  const radius = (RING_SIZE - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  const label = formatContextUsageLabel(usage);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
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
      <TooltipContent className="text-xs" side="top">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
