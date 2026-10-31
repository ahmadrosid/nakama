import { Button } from "@nakama/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { ArrowUp01Icon, Notification01Icon } from "hugeicons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { NotificationList } from "@/components/notifications/notification-list";
import { WebPushToggle } from "@/components/notifications/web-push-toggle";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useNotifications } from "@/hooks/use-notifications";
import { PAGE_PATHS } from "@/lib/navigation";

const MAX_FACES = 3;

/** Dock at the bottom of the sidebar; shows only while something waits. */
export function SidebarNotifications({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const { items, totalCount } = useNotifications();
  const { data: profiles = [] } = useProfilesQuery();

  if (totalCount === 0) {
    return null;
  }

  const countLabel = totalCount > 99 ? "99+" : String(totalCount);
  const label = `${totalCount} need you`;
  const waitingProfileIds = new Set(items.map((item) => item.profileId));

  const faces = profiles
    .filter((profile) => waitingProfileIds.has(profile.id))
    .slice(0, MAX_FACES);

  const trigger = collapsed ? (
    <button
      aria-label={label}
      className="relative flex size-9 items-center justify-center rounded-lg bg-foreground text-background"
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
      className="flex h-11 w-full items-center gap-2.5 rounded-xl bg-foreground px-2.5 text-background text-sm transition-opacity hover:opacity-90"
      type="button"
    >
      {faces.length > 0 ? (
        <span aria-hidden className="flex shrink-0">
          {faces.map((profile, index) => (
            <ProfileAvatar
              className={
                index === 0
                  ? "ring-2 ring-foreground"
                  : "-ml-2 ring-2 ring-foreground"
              }
              key={profile.id}
              profile={profile}
              size="xs"
            />
          ))}
        </span>
      ) : (
        <Notification01Icon aria-hidden className="size-4 shrink-0" />
      )}
      <span className="flex-1 truncate text-left font-medium">{label}</span>
      <ArrowUp01Icon aria-hidden className="size-4 shrink-0" />
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
          <p className="px-1.5 py-1.5 font-medium text-foreground text-sm leading-tight">
            Needs you
          </p>
          <div className="max-h-72 overflow-y-auto">
            <NotificationList
              compact
              items={items}
              onNavigate={() => setOpen(false)}
            />
          </div>
          <div className="px-1.5 pt-0.5 pb-1">
            <Button
              className="h-7 w-full justify-center text-xs"
              nativeButton={false}
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
          <div className="mt-1 border-border border-t pt-1">
            <WebPushToggle />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
