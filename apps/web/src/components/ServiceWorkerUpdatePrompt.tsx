import { Button } from "@nakama/ui/button";
import { RefreshIcon } from "hugeicons-react";
import { useState } from "react";
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker-update";

/** Set for the rest of the browser session after the user picks Later. */
const UPDATE_LATER_KEY = "nakama-update-later";

function readLater(): boolean {
  try {
    return sessionStorage.getItem(UPDATE_LATER_KEY) === "1";
  } catch {
    return false;
  }
}

export function ServiceWorkerUpdatePrompt() {
  const { applyUpdate, updateReady, version } = useServiceWorkerUpdate();
  const [later, setLater] = useState(readLater);

  if (!updateReady || later) {
    return null;
  }

  const postpone = () => {
    try {
      sessionStorage.setItem(UPDATE_LATER_KEY, "1");
    } catch {
      // Storage can be blocked; Later still hides the prompt for this page.
    }

    setLater(true);
  };

  return (
    <div
      aria-label="App update"
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-3 shadow-lg sm:inset-x-auto sm:right-4"
      role="status"
    >
      <RefreshIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-primary"
        strokeWidth={1.75}
      />
      <p className="min-w-0 flex-1 truncate text-foreground text-sm">
        {version ? `Nakama ${version} is ready.` : "A new version is ready."}
      </p>
      <div className="flex shrink-0 gap-1">
        <Button onClick={postpone} size="sm" type="button" variant="ghost">
          Later
        </Button>
        <Button onClick={applyUpdate} size="sm" type="button">
          Reload
        </Button>
      </div>
    </div>
  );
}
