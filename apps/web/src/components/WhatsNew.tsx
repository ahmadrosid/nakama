import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ReleaseChangeList } from "@/components/ServiceWorkerUpdatePrompt";
import { queryKeys } from "@/lib/query-keys";
import { fetchReleaseNotes, findReleaseNote } from "@/lib/release-notes";

/** The last version whose notes this browser has shown. */
const SEEN_KEY = "nakama-whats-new-seen";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function useReleaseNotesQuery(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: fetchReleaseNotes,
    queryKey: queryKeys.releaseNotes,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Shows the notes for this page's build one time after it changes. While it
 * has nothing to show it renders `children`, so two bottom cards never stack.
 */
export function WhatsNewCard({ children }: { children?: ReactNode }) {
  // The build version, not /health: the server can run a newer build than
  // the page until the service worker update is applied.
  const version = import.meta.env.VITE_NAKAMA_VERSION?.trim() || null;
  const [seen, setSeen] = useState(readSeen);
  const changed = version !== null && seen !== null && seen !== version;
  const notesQuery = useReleaseNotesQuery(changed);
  const note = findReleaseNote(notesQuery.data ?? [], version);
  const hasChanges = (note?.changes.length ?? 0) > 0;

  const markSeen = useCallback(() => {
    if (!version) {
      return;
    }

    try {
      localStorage.setItem(SEEN_KEY, version);
    } catch {
      // Storage can be blocked; the card then hides for this page only.
    }

    setSeen(version);
  }, [version]);

  useEffect(() => {
    // A first visit has no earlier version to compare with, so it shows nothing.
    const firstVisit = version !== null && seen === null;
    // A failed fetch keeps the old version, so the notes show on a later visit.
    const nothingToShow = changed && notesQuery.isSuccess && !hasChanges;

    if (firstVisit || nothingToShow) {
      markSeen();
    }
  }, [changed, hasChanges, markSeen, notesQuery.isSuccess, seen, version]);

  if (changed && notesQuery.isPending) {
    return null;
  }

  if (!(changed && note && hasChanges)) {
    return children;
  }

  return (
    <section
      aria-label="What's new"
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 mx-auto w-[min(24rem,calc(100%-2rem))] rounded-xl border border-border bg-card p-4 shadow-lg"
    >
      <p className="mb-2 font-medium text-foreground text-sm">
        What's new in Nakama {note.version}
      </p>
      <ReleaseChangeList changes={note.changes} />
      <div className="mt-3 flex justify-end">
        <Button onClick={markSeen} size="sm" type="button">
          Got it
        </Button>
      </div>
    </section>
  );
}

export function WhatsNewDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const notesQuery = useReleaseNotesQuery(open);
  const notes = notesQuery.data ?? [];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
        </DialogHeader>
        {notesQuery.isPending ? null : (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-muted-foreground text-sm">No notes yet.</p>
            ) : (
              notes.map((note) => (
                <section key={note.version}>
                  <h3 className="mb-1 font-medium font-mono text-muted-foreground text-xs tabular-nums">
                    {note.version}
                  </h3>
                  <ReleaseChangeList changes={note.changes} />
                </section>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
