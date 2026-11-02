import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { ArrowUp01Icon, Notification01Icon } from "hugeicons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { NotificationList } from "@/components/notifications/notification-list";
import { WebPushToggle } from "@/components/notifications/web-push-toggle";
import { useNotifications } from "@/hooks/use-notifications";
import { PAGE_PATHS } from "@/lib/navigation";

/** Dock at the bottom of the sidebar; shows only while something waits. */
export function SidebarNotifications({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const { items, totalCount } = useNotifications();

  if (totalCount === 0) {
    return null;
  }

  const countLabel = totalCount > 99 ? "99+" : String(totalCount);
  const label = `${totalCount} need you`;

  const trigger = collapsed ? (
    <button
      aria-label={label}
      className="relative flex size-9 items-center justify-center rounded-lg bg-foreground/5 text-foreground transition-colors hover:bg-foreground/10"
      type="button"
    >
      <Notification01Icon aria-hidden className="size-4" />
      <span
        aria-hidden
        className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-sidebar bg-primary px-0.5 font-bold text-2xs text-primary-foreground tabular-nums leading-none"
      >
        {countLabel}
      </span>
    </button>
  ) : (
    <button
      aria-label={label}
      className="flex h-10 w-full items-center gap-2.5 rounded-lg bg-foreground/5 px-3 text-foreground text-sm transition-colors hover:bg-foreground/10"
      type="button"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="flex-1 truncate text-left font-medium">{label}</span>
      <ArrowUp01Icon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );

  return (
    <div
      className={
        collapsed ? "flex shrink-0 justify-center p-2" : "shrink-0 px-2 pb-2"
      }
    >
      <Popover onOpenChange={setOpen} open={open}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <PopoverTrigger render={trigger} />
                </span>
              }
            />
            <TooltipContent side="right" sideOffset={8}>
              {label}
            </TooltipContent>
          </Tooltip>
        ) : (
          <PopoverTrigger render={trigger} />
        )}

        <PopoverContent
          align="start"
          className="w-72 p-1"
          side={collapsed ? "right" : "top"}
          sideOffset={8}
        >
          <div className="flex h-7 items-center justify-between px-1.5">
            <p className="font-semibold text-2xs text-muted-foreground uppercase tracking-wide">
              Needs you
            </p>
            <Link
              className="font-medium text-primary text-xs hover:underline"
              onClick={() => setOpen(false)}
              to={PAGE_PATHS.notifications}
            >
              View all
            </Link>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <NotificationList
              compact
              items={items}
              onNavigate={() => setOpen(false)}
            />
          </div>
          <div className="mt-1 border-border border-t pt-1">
            <WebPushToggle />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
