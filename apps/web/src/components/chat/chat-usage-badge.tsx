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
      <path d="m7.32155 7.32156c-3.07956.93356-5.32155 3.79314-5.32155 7.17844 0 4.1421 3.35786 7.5 7.5 7.5 3.3853 0 6.2449-2.242 7.1784-5.3216 3.0796-.9335 5.3216-3.7931 5.3216-7.1784 0-4.14214-3.3579-7.5-7.5-7.5-3.3853 0-6.24488 2.24199-7.17845 5.32156zm2.27751-.32092c4.06354.0526 7.34774 3.33676 7.40034 7.40026 1.7812-.9103 3.0006-2.764 3.0006-4.9009 0-3.03757-2.4624-5.5-5.5-5.5-2.1369 0-3.9906 1.21936-4.90094 3.00064zm-.09906 1.99936c-.39541 0-.78001.04157-1.15004.12021-2.48569.52831-4.34996 2.73749-4.34996 5.37979 0 3.0376 2.46243 5.5 5.5 5.5 2.6423 0 4.8515-1.8643 5.3798-4.35.0786-.37.1202-.7546.1202-1.15 0-3.0376-2.4624-5.5-5.5-5.5zm0 4.4142-1.08579 1.0858 1.08579 1.0858 1.0858-1.0858zm-1.43934.7322c.0002.0002.00039.0004.00059.0006zm.37868-2.5c.58578-.5857 1.53553-.5857 2.12136 0l1.7929 1.7929c.5857.5858.5857 1.5356 0 2.1214l-1.7929 1.7929c-.58582.5857-1.53557.5857-2.12136 0l-1.79289-1.7929c-.58579-.5858-.58579-1.5356 0-2.1214z" />
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
