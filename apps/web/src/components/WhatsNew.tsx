import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  NewReleasesIcon,
} from "hugeicons-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ChatComposerNotice } from "@/components/chat/chat-tips";
import { queryKeys } from "@/lib/query-keys";
import {
  fetchReleaseNotes,
  findReleaseNote,
  RELEASE_CHANGE_LABELS,
  type ReleaseNote,
} from "@/lib/release-notes";

/** The last version whose notes this browser has shown. */
const SEEN_KEY = "nakama-whats-new-seen";

const KIND_ORDER = ["new", "changed", "fixed"] as const;

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
 * Shows the notes for this page's build one time after it changes, in the
 * composer's notice line. Until then, and after, it renders `children`.
 */
export function WhatsNewNotice({ children }: { children?: ReactNode }) {
  // The build version, not /health: the server can run a newer build than
  // the page until the service worker update is applied.
  const version = import.meta.env.VITE_NAKAMA_VERSION?.trim() || null;
  const [seen, setSeen] = useState(readSeen);
  const [dialogOpen, setDialogOpen] = useState(false);
  const changed = version !== null && seen !== null && seen !== version;
  const notesQuery = useReleaseNotesQuery(changed);
  const note = findReleaseNote(notesQuery.data ?? [], version);
  const first = note?.changes[0];

  const markSeen = useCallback(() => {
    if (!version) {
      return;
    }

    try {
      localStorage.setItem(SEEN_KEY, version);
    } catch {
      // Storage can be blocked; the notice then hides for this page only.
    }

    setSeen(version);
  }, [version]);

  useEffect(() => {
    // A first visit has no earlier version to compare with, so it shows nothing.
    const firstVisit = version !== null && seen === null;
    // A failed fetch keeps the old version, so the notes show on a later visit.
    const nothingToShow = changed && notesQuery.isSuccess && !first;

    if (firstVisit || nothingToShow) {
      markSeen();
    }
  }, [changed, first, markSeen, notesQuery.isSuccess, seen, version]);

  if (!(changed && note && first)) {
    return children;
  }

  return (
    <>
      <ChatComposerNotice>
        <section
          aria-label="What's new"
          className="flex items-center gap-2 text-muted-foreground text-xs"
        >
          <NewReleasesIcon
            aria-hidden
            className="size-3 shrink-0 text-primary/80"
          />
          <p className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">
              Updated to {note.version}
            </span>{" "}
            {first.text}
          </p>
          <Button
            className="h-6 px-2 text-xs"
            onClick={() => setDialogOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            See what's new
          </Button>
          <Button
            aria-label="Close"
            className="size-6"
            onClick={markSeen}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Cancel01Icon aria-hidden className="size-3" />
          </Button>
        </section>
      </ChatComposerNotice>
      <WhatsNewDialog
        onOpenChange={(open) => {
          setDialogOpen(open);

          if (!open) {
            markSeen();
          }
        }}
        open={dialogOpen}
      />
    </>
  );
}

function ReleaseChangeGroups({ changes }: { changes: ReleaseNote["changes"] }) {
  return (
    <div className="space-y-3">
      {KIND_ORDER.map((kind) => {
        // A repeated line adds nothing, and the text is the list key.
        const texts = [
          ...new Set(
            changes
              .filter((change) => change.kind === kind)
              .map((change) => change.text)
          ),
        ];

        return texts.length === 0 ? null : (
          <div key={kind}>
            <h4 className="mb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              {RELEASE_CHANGE_LABELS[kind]}
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-foreground text-sm">
              {texts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
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
  const [latest, ...older] = notesQuery.data ?? [];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
        </DialogHeader>
        {notesQuery.isPending ? null : (
          <div className="space-y-4">
            {latest ? (
              <section>
                <h3 className="mb-2 font-medium font-mono text-sm tabular-nums">
                  {latest.version}
                </h3>
                <ReleaseChangeGroups changes={latest.changes} />
              </section>
            ) : (
              <p className="text-muted-foreground text-sm">No notes yet.</p>
            )}
            {older.length > 0 ? (
              <div className="divide-y divide-border border-border border-t">
                {older.map((note) => (
                  <details className="group py-1" key={note.version}>
                    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between font-medium font-mono text-sm tabular-nums">
                      {note.version}
                      <ArrowDown01Icon
                        aria-hidden
                        className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <div className="pb-2">
                      <ReleaseChangeGroups changes={note.changes} />
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
