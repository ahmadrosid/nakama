import { Button } from "@nakama/ui/button";
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
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-4 shadow-lg sm:inset-x-auto sm:right-4"
      role="status"
    >
      <p className="min-w-0 flex-1 truncate text-foreground text-sm">
        {version ? `Nakama ${version} is ready.` : "A new version is ready."}
      </p>
      <div className="flex shrink-0 gap-1">
        <Button onClick={postpone} size="sm" type="button" variant="ghost">
          Later
        </Button>
        <Button
          className="gap-1.5"
          onClick={applyUpdate}
          size="sm"
          type="button"
        >
          {/* RefreshCwIcon from @hugeicons/core-free-icons 4.3 (MIT); the locked 3.x lacks it. */}
          <svg
            aria-hidden="true"
            data-icon="inline-start"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path d="M3.04712 13C3.01082 12.6717 2.99219 12.338 2.99219 12C2.99219 7.02944 7.02162 3 11.9922 3C14.8195 3 17.3422 4.30367 18.9922 6.34267M20.9373 11C20.9736 11.3283 20.9922 11.662 20.9922 12C20.9922 16.9706 16.9628 21 11.9922 21C9.16492 21 6.64214 19.6963 4.99219 17.6573" />
            <path d="M15.9922 7H16.9922C18.4064 7 19.1135 7 19.5528 6.56066C19.9922 6.12132 19.9922 5.41421 19.9922 4V3" />
            <path d="M7.99219 17H6.99219C5.57797 17 4.87087 17 4.43153 17.4393C3.99219 17.8787 3.99219 18.5858 3.99219 20V21" />
          </svg>
          Reload
        </Button>
      </div>
    </div>
  );
}
