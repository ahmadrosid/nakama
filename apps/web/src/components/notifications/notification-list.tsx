import { cn } from "@nakama/ui/utils";
import { ArrowRight01Icon, BrainIcon, SharedWifiIcon } from "hugeicons-react";
import { Link } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import type { NotificationItem } from "@/hooks/use-notifications";
import { formatSessionRelativeTime } from "@/lib/chat-history";

function NotificationIcon({ kind }: { kind: NotificationItem["kind"] }) {
  const Icon = kind === "automation-run" ? SharedWifiIcon : BrainIcon;

  return (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

function CompactNotificationListItem({
  item,
  onSelect,
}: {
  item: NotificationItem;
  onSelect: () => void;
}) {
  return (
    <Link
      className="flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm transition-colors hover:bg-accent"
      onClick={onSelect}
      to={item.href}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{item.title}</span>
        {item.description ? (
          <span className="text-muted-foreground"> · {item.description}</span>
        ) : null}
      </span>
      {item.count > 1 ? (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 font-semibold text-2xs text-primary-foreground tabular-nums">
          {item.count > 99 ? "99+" : item.count}
        </span>
      ) : null}
      {item.createdAt ? (
        <time
          className="shrink-0 text-2xs text-muted-foreground tabular-nums"
          dateTime={item.createdAt}
        >
          {formatSessionRelativeTime(item.createdAt)}
        </time>
      ) : null}
    </Link>
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
  const { setProfileId } = useActiveChatProfile();

  const onSelect = () => {
    if (item.profileId) {
      setProfileId(item.profileId);
    }

    onNavigate?.();
  };

  if (compact) {
    return <CompactNotificationListItem item={item} onSelect={onSelect} />;
  }

  return (
    <Link
      className="flex min-w-0 gap-3 overflow-hidden px-4 py-3 transition-colors hover:bg-muted/60"
      onClick={onSelect}
      to={item.href}
    >
      <NotificationIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-words font-normal text-foreground text-sm leading-tight">
            {item.title}
          </p>
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
        <p className="mt-1 min-w-0 whitespace-pre-wrap break-all text-muted-foreground text-xs leading-relaxed">
          {item.description}
        </p>
      </div>
      <ArrowRight01Icon
        aria-hidden
        className="size-4 shrink-0 self-center text-muted-foreground"
      />
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
    <div className={cn(compact ? "space-y-0.5" : "divide-y divide-border")}>
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
