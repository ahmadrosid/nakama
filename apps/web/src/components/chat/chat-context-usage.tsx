import {
  contextUsageRatio,
  formatContextUsageLabel,
  type ChatContextUsage,
} from "@/lib/chat-context-usage";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
            type="button"
            className={cn(
              "inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              className,
            )}
            aria-label={label}
          >
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              className="-rotate-90"
              aria-hidden
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={radius}
                fill="none"
                strokeWidth={STROKE_WIDTH}
                className="stroke-muted-foreground/25"
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={radius}
                fill="none"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={cn(
                  "transition-[stroke-dashoffset,stroke] duration-300",
                  progressStrokeClass(ratio),
                )}
              />
            </svg>
          </button>
        }
      />
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
