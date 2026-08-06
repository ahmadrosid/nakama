import { BrainIcon, WorkflowIcon } from "lucide-react";
import { Link } from "react-router-dom";
import type { NotificationItem } from "@/hooks/use-notifications";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

function NotificationIcon({
  kind,
  size = "md",
}: {
  kind: NotificationItem["kind"];
  size?: "sm" | "md";
}) {
  const Icon = kind === "automation-run" ? WorkflowIcon : BrainIcon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        size === "sm" ? "size-7" : "size-9",
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
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
      to={item.href}
      onClick={onNavigate}
      className={cn(
        "flex min-w-0 overflow-hidden rounded-md transition-colors hover:bg-muted/60",
        compact ? "gap-2.5 px-2 py-2" : "gap-2.5 px-2 py-2.5",
      )}
    >
      <NotificationIcon kind={item.kind} size={compact ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight text-foreground">{item.title}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {item.count > 1 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
                {item.count > 99 ? "99+" : item.count}
              </span>
            ) : null}
            {item.createdAt ? (
              <time
                dateTime={item.createdAt}
                className="text-[11px] tabular-nums text-muted-foreground"
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
              : "mt-1.5 whitespace-pre-wrap text-sm leading-relaxed",
          )}
        >
          {item.description}
        </p>
      </div>
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
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className={cn(compact ? "space-y-1 py-0.5" : "space-y-2")}>
      {items.map((item) => (
        <NotificationListItem
          key={item.id}
          item={item}
          compact={compact}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
