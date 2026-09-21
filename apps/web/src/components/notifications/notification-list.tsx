import { cn } from "@nakama/ui/utils";
import { ArrowRight01Icon, BrainIcon, SharedWifiIcon } from "hugeicons-react";
import { Link } from "react-router-dom";
import type { NotificationItem } from "@/hooks/use-notifications";
import { formatSessionRelativeTime } from "@/lib/chat-history";

function NotificationIcon({
  kind,
  size = "md",
}: {
  kind: NotificationItem["kind"];
  size?: "sm" | "md";
}) {
  const Icon = kind === "automation-run" ? SharedWifiIcon : BrainIcon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center text-muted-foreground",
        size === "sm" ? "size-7 rounded-md bg-muted" : "mt-0.5 size-4"
      )}
    >
      <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}

function NotificationListItem({
  item,
  compact = false,
  onNavigate,
}: {
  item: NotificationItem;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      className={cn(
        "flex min-w-0 overflow-hidden transition-colors hover:bg-muted/60",
        compact ? "gap-2.5 rounded-md px-2 py-2" : "gap-3 px-4 py-3"
      )}
      onClick={onNavigate}
      to={item.href}
    >
      <NotificationIcon kind={item.kind} size={compact ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p
              className={cn(
                "text-foreground text-sm leading-tight",
                compact ? "truncate font-medium" : "break-words font-normal"
              )}
            >
              {item.title}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {item.count > 1 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 font-semibold text-2xs text-primary-foreground tabular-nums">
                {item.count > 99 ? "99+" : item.count}
              </span>
            ) : null}
            {item.createdAt ? (
              <time
                className="text-2xs text-muted-foreground tabular-nums"
                dateTime={item.createdAt}
              >
                {formatSessionRelativeTime(item.createdAt)}
              </time>
            ) : null}
          </div>
        </div>
        <p
          className={cn(
            "min-w-0 break-all text-muted-foreground",
            compact
              ? "mt-1 line-clamp-2 text-xs leading-snug"
              : "mt-1 whitespace-pre-wrap text-xs leading-relaxed"
          )}
        >
          {item.description}
        </p>
      </div>
      {!compact && (
        <ArrowRight01Icon
          aria-hidden
          className="size-4 shrink-0 self-center text-muted-foreground"
        />
      )}
    </Link>
  );
}

export function NotificationList({
  items,
  compact = false,
  onNavigate,
  emptyMessage = "You're all caught up.",
}: {
  items: NotificationItem[];
  compact?: boolean;
  onNavigate?: () => void;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <div
      className={cn(compact ? "space-y-1 py-0.5" : "divide-y divide-border")}
    >
      {items.map((item) => (
        <NotificationListItem
          compact={compact}
          item={item}
          key={item.id}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
