import { BellIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { NotificationList } from "@/components/notifications/notification-list";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
      type="button"
      aria-label={
        showBadge
          ? `Notifications, ${totalCount} unread`
          : "Notifications"
      }
      className="relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-foreground"
    >
      <span className="relative shrink-0">
        <BellIcon className="size-4" strokeWidth={1.75} aria-hidden />
        {showBadge ? (
          <span
            className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-sidebar bg-primary px-0.5 text-[9px] font-bold leading-none tabular-nums text-primary-foreground"
            aria-hidden
          >
            {badgeLabel}
          </span>
        ) : null}
      </span>
    </button>
  );

  const isEmpty = !isLoading && items.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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

      <PopoverContent side="right" align="end" sideOffset={8} className="w-72 p-1">
        {isEmpty ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">All caught up</p>
        ) : (
          <>
            <div className="px-1.5 py-1.5">
              <p className="text-sm font-medium leading-tight text-foreground">Notifications</p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                Automation runs and org memory proposals
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {isLoading ? (
                <p className="px-1.5 py-2 text-xs text-muted-foreground">Loading…</p>
              ) : (
                <NotificationList items={items} compact onNavigate={() => setOpen(false)} />
              )}
            </div>

            <div className="px-1.5 pb-1 pt-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs"
                render={<Link to={PAGE_PATHS.notifications} onClick={() => setOpen(false)} />}
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
