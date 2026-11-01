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
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-border bg-card py-2 pr-2 pl-4 shadow-lg"
      role="status"
    >
      <p className="mr-1 text-foreground text-sm">
        {version ? `Nakama ${version} is ready.` : "A new version is ready."}
      </p>
      <Button onClick={postpone} size="sm" type="button" variant="ghost">
        Later
      </Button>
      <Button onClick={applyUpdate} size="sm" type="button">
        <RefreshIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        Reload
      </Button>
    </div>
  );
}
