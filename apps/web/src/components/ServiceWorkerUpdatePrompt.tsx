import { Button } from "@nakama/ui/button";
import { RefreshIcon } from "hugeicons-react";
import { useState } from "react";
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker-update";
import { RELEASE_CHANGE_LABELS, type ReleaseNote } from "@/lib/release-notes";

/** Set for the rest of the browser session after the user picks Later. */
const UPDATE_LATER_KEY = "nakama-update-later";

/** The prompt stays small: only the first lines of the release show. */
const MAX_CHANGES = 3;

function readLater(): boolean {
  try {
    return sessionStorage.getItem(UPDATE_LATER_KEY) === "1";
  } catch {
    return false;
  }
}

function ReleaseChangeList({
  changes,
  max,
}: {
  changes: ReleaseNote["changes"];
  max?: number;
}) {
  // A repeated line adds nothing, and kind plus text is the list key.
  const unique = [
    ...new Map(
      changes.map((change) => [`${change.kind}:${change.text}`, change])
    ).values(),
  ].slice(0, max);

  return (
    <ul className="space-y-1 text-sm">
      {unique.map((change) => (
        <li className="text-foreground" key={`${change.kind}:${change.text}`}>
          <span className="text-muted-foreground">
            {RELEASE_CHANGE_LABELS[change.kind]}:
          </span>{" "}
          {change.text}
        </li>
      ))}
    </ul>
  );
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

  const changes = note?.changes ?? [];

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
      {changes.length > 0 ? (
        <div className="mt-2">
          <ReleaseChangeList changes={changes} max={MAX_CHANGES} />
        </div>
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
