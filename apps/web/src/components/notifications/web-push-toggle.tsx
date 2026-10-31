import { Switch } from "@nakama/ui/switch";
import { useWebPush, webPushSupported } from "@/hooks/use-web-push";

export function WebPushToggle() {
  const { busy, enabled, error, setPush } = useWebPush();

  if (!webPushSupported) {
    return (
      <p className="px-1.5 py-1.5 text-2xs text-muted-foreground leading-snug">
        This browser cannot show notifications. On iPhone, add Nakama to the
        Home Screen first.
      </p>
    );
  }

  return (
    <div className="px-1.5 py-1.5" id="web-push-toggle">
      <div className="flex items-center justify-between gap-2">
        <label className="text-foreground text-xs" htmlFor="web-push-switch">
          Notify me when a reply is ready
        </label>
        <Switch
          checked={enabled === true}
          disabled={busy || enabled === null}
          id="web-push-switch"
          onCheckedChange={(next) => {
            setPush(next).catch(() => undefined);
          }}
          size="sm"
        />
      </div>
      {error ? (
        <p className="mt-1 text-2xs text-destructive leading-snug">{error}</p>
      ) : null}
    </div>
  );
}
