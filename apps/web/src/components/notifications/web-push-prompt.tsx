import { Button } from "@nakama/ui/button";
import { Notification01Icon } from "hugeicons-react";
import { useState } from "react";
import { useWebPush, webPushSupported } from "@/hooks/use-web-push";

const DISMISSED_KEY = "nakama.webPushPrompt.dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** One-time offer to turn on reply notifications for this device. */
export function WebPushPrompt() {
  const { busy, enabled, error, setPush } = useWebPush();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (
    !webPushSupported ||
    dismissed ||
    enabled !== false ||
    Notification.permission === "denied"
  ) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode: it asks again next visit, which is the safe side.
    }

    setDismissed(true);
  };

  return (
    <div
      aria-label="Reply notifications"
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:w-80"
      id="web-push-prompt"
      role="status"
    >
      <div className="flex gap-3">
        <Notification01Icon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div className="min-w-0">
          <p className="font-medium text-foreground text-sm">
            Get notified when a reply is ready?
          </p>
          <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
            When an agent finishes answering while you are away, this device
            shows a notification. You can change it later from the bell.
          </p>
          {error ? (
            <p className="mt-1 text-destructive text-xs leading-snug">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          disabled={busy}
          onClick={dismiss}
          size="sm"
          type="button"
          variant="ghost"
        >
          No thanks
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setPush(true).catch(() => undefined);
          }}
          size="sm"
          type="button"
        >
          Turn on
        </Button>
      </div>
    </div>
  );
}
