import { Button } from "@nakama/ui/button";
import { RefreshIcon } from "hugeicons-react";
import { useState } from "react";
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker-update";
import { RELEASE_CHANGE_LABELS } from "@/lib/release-notes";

/** Set for the rest of the browser session after the user picks Later. */
const UPDATE_LATER_KEY = "nakama-update-later";

/** The prompt stays small; the full list lives in What's new. */
const MAX_CHANGES = 3;

function readLater(): boolean {
  try {
    return sessionStorage.getItem(UPDATE_LATER_KEY) === "1";
  } catch {
    return false;
  }
}

export function ServiceWorkerUpdatePrompt() {
  const { applyUpdate, note, updateReady, version } = useServiceWorkerUpdate();
  const [later, setLater] = useState(readLater);
  const critical = note?.critical;

  if (!updateReady || (later && !critical)) {
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

  const changes = note?.changes.slice(0, MAX_CHANGES) ?? [];

  return (
    <div
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 mx-auto w-[min(24rem,calc(100%-2rem))] rounded-xl border border-border bg-card p-4 shadow-lg"
      role="status"
    >
      <p className="font-medium text-foreground text-sm">
        {version ? `Nakama ${version} is ready` : "A new version is ready"}
      </p>
      {critical ? (
        <p className="mt-1 text-muted-foreground text-sm">{critical}</p>
      ) : null}
      {!critical && changes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {changes.map((change) => (
            <li className="text-foreground" key={change.text}>
              <span className="text-muted-foreground">
                {RELEASE_CHANGE_LABELS[change.kind]}:
              </span>{" "}
              {change.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        {critical ? null : (
          <Button onClick={postpone} size="sm" type="button" variant="ghost">
            Later
          </Button>
        )}
        <Button onClick={applyUpdate} size="sm" type="button">
          <RefreshIcon
            aria-hidden="true"
            className="size-4"
            strokeWidth={1.75}
          />
          Reload
        </Button>
      </div>
    </div>
  );
}
