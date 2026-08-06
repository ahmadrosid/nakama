import { Spinner } from "@/components/ui/spinner";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotifications } from "@/hooks/use-notifications";

export function NotificationsPage() {
  const { items, totalCount, isLoading } = useNotifications();

  if (isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl">
      {totalCount === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">All caught up</p>
      ) : (
        <NotificationList items={items} />
      )}
    </div>
  );
}
