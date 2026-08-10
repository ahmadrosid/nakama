import { Notification01Icon } from "hugeicons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { NotificationList } from "@/components/notifications/notification-list";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNotifications } from "@/hooks/use-notifications";
import { PAGE_PATHS } from "@/lib/navigation";

export function SidebarNotifications() {
  const [open, setOpen] = useState(false);
  const { items, totalCount, isLoading } = useNotifications();
  const showBadge = totalCount > 0;
  const badgeLabel = totalCount > 99 ? "99+" : String(totalCount);

  const trigger = (
    <button
      aria-label={
        showBadge ? `Notifications, ${totalCount} unread` : "Notifications"
      }
      className="relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-foreground"
      type="button"
    >
      <span className="relative shrink-0">
        <Notification01Icon aria-hidden className="size-4" />
        {showBadge ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-sidebar bg-primary px-0.5 font-bold text-[9px] text-primary-foreground tabular-nums leading-none"
          >
            {badgeLabel}
          </span>
        ) : null}
      </span>
    </button>
  );

  const isEmpty = !isLoading && items.length === 0;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <PopoverTrigger render={trigger} />
            </span>
          }
        />
        <TooltipContent side="right" sideOffset={8}>
          {showBadge ? `Notifications (${totalCount})` : "Notifications"}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        className="w-72 p-1"
        side="right"
        sideOffset={8}
      >
        {isEmpty ? (
          <p className="px-2 py-3 text-center text-muted-foreground text-xs">
            All caught up
          </p>
        ) : (
          <>
            <div className="px-1.5 py-1.5">
              <p className="font-medium text-foreground text-sm leading-tight">
                Notifications
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Automation runs and org memory proposals
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {isLoading ? (
                <p className="px-1.5 py-2 text-muted-foreground text-xs">
                  Loading…
                </p>
              ) : (
                <NotificationList
                  compact
                  items={items}
                  onNavigate={() => setOpen(false)}
                />
              )}
            </div>

            <div className="px-1.5 pt-0.5 pb-1">
              <Button
                className="h-7 w-full justify-center text-xs"
                render={
                  <Link
                    onClick={() => setOpen(false)}
                    to={PAGE_PATHS.notifications}
                  />
                }
                size="sm"
                type="button"
              >
                View all
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
