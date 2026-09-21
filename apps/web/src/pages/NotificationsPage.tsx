import { Card } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotifications } from "@/hooks/use-notifications";

export function NotificationsPage() {
  const { items, totalCount, isLoading } = useNotifications();

  if (isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center text-muted-foreground text-sm">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden shadow-none">
      {totalCount === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          All caught up
        </p>
      ) : (
        <NotificationList items={items} />
      )}
    </Card>
  );
}
