import type { ChatUsage } from "@nakama/core/contract";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from "@nakama/ui/popover";
import { cn } from "@nakama/ui/utils";
import {
  chatUsageTitle,
  formatChatUsageCost,
  formatCompactTokens,
  formatUsd,
} from "@/lib/chat-usage";

/**
 * Two linked coins with a token at the centre. `evenodd` is what hollows the
 * outlines, and `currentColor` keeps the mark on the surrounding text colour.
 */
function ChatUsageIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m 7.32 7.32 c -3.08 0.93 -5.32 3.79 -5.32 7.18 0 4.14 3.36 7.5 7.5 7.5 3.39 0 6.24 -2.24 7.18 -5.32 3.08 -0.93 5.32 -3.79 5.32 -7.18 0 -4.14 -3.36 -7.5 -7.5 -7.5 -3.39 0 -6.24 2.24 -7.18 5.32 z m 2.28 -0.32 c 4.06 0.05 7.35 3.34 7.4 7.4 1.78 -0.91 3 -2.76 3 -4.9 0 -3.04 -2.46 -5.5 -5.5 -5.5 -2.14 0 -3.99 1.22 -4.9 3 z m -0.1 2 c -0.4 0 -0.78 0.04 -1.15 0.12 -2.49 0.53 -4.35 2.74 -4.35 5.38 0 3.04 2.46 5.5 5.5 5.5 2.64 0 4.85 -1.86 5.38 -4.35 0.08 -0.37 0.12 -0.75 0.12 -1.15 0 -3.04 -2.46 -5.5 -5.5 -5.5 z m 0 4.41 -1.09 1.09 1.09 1.09 1.09 -1.09 z m -1.44 0.73 c 0 0 0 0 0 0 z m 0.38 -2.5 c 0.59 -0.59 1.54 -0.59 2.12 0 l 1.79 1.79 c 0.59 0.59 0.59 1.54 0 2.12 l -1.79 1.79 c -0.59 0.59 -1.54 0.59 -2.12 0 l -1.79 -1.79 c -0.59 -0.59 -0.59 -1.54 0 -2.12 z" />
    </svg>
  );
}

function UsageDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-6">
      <span>{label}</span>
      <span className="text-muted-foreground tabular-nums">{value}</span>
    </li>
  );
}

/** Cost chip under an assistant reply. Click for in / out / total. */
export function ChatUsageBadge({
  usage,
  className,
}: {
  usage: ChatUsage;
  className?: string;
}) {
  const cost = formatChatUsageCost(usage);
  const label = chatUsageTitle(usage);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={label}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-muted-foreground text-xs tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              className
            )}
            type="button"
          >
            <ChatUsageIcon className="size-3.5 shrink-0" />
            {cost}
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="w-56 min-w-56 p-3.5"
        side="top"
        sideOffset={8}
      >
        <PopoverHeader title="Usage" />
        <ul className="flex flex-col gap-2 text-sm">
          <UsageDetailRow
            label="In"
            value={formatCompactTokens(usage.inputTokens)}
          />
          <UsageDetailRow
            label="Out"
            value={formatCompactTokens(usage.outputTokens)}
          />
          <UsageDetailRow
            label="Total"
            value={usage.totalTokens.toLocaleString()}
          />
          {usage.costUsd == null ? null : (
            <UsageDetailRow label="Cost" value={formatUsd(usage.costUsd)} />
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
