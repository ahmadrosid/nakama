import type { ProfileChangeEvent } from "@nakama/core";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { buildFileDiffRows, FileDiff } from "@/components/file-diff";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function formatFieldLabel(field: ProfileChangeEvent["field"]): string {
  switch (field) {
    case "system_prompt":
      return "System prompt";
    case "soul.soul":
      return "SOUL.md";
    case "soul.style":
      return "STYLE.md";
    case "soul.instructions":
      return "INSTRUCTIONS.md";
    case "soul.memory":
      return "MEMORY.md";
    case "tools":
      return "Tools";
    case "skills":
      return "Skills";
    case "mcp":
      return "MCP";
    case "pack_import":
      return "Pack import";
    default:
      return field;
  }
}

function formatSourceLabel(source: ProfileChangeEvent["source"]): string {
  switch (source) {
    case "dashboard":
      return "Dashboard";
    case "super_bot":
      return "Super Bot";
    case "skill_manage":
      return "Skill manager";
    case "pack_import":
      return "Pack import";
    default:
      return source;
  }
}

function formatActorLabel(event: ProfileChangeEvent): string | null {
  return event.actorName || (event.actorUserId ? "Unknown user" : null);
}

function buildChangeRows(event: ProfileChangeEvent) {
  const rows = buildFileDiffRows(event.beforeValue, event.afterValue, {
    formatJson: ["tools", "skills", "mcp", "pack_import"].includes(event.field),
  });
  if (!event.assignmentNames) {
    return rows;
  }
  const names = new Map(Object.entries(event.assignmentNames));
  const unavailable =
    event.field === "skills" ? "Unavailable skill" : "Unavailable tool";
  return rows.map((row) => ({
    ...row,
    text: row.text.replace(/"(?:[^"\\]|\\.)*"/g, (value) =>
      JSON.stringify(names.get(JSON.parse(value)) || unavailable)
    ),
  }));
}

function AssignmentChangeSummary({ event }: { event: ProfileChangeEvent }) {
  const changes = event.assignmentChanges;
  if (!changes) {
    return null;
  }
  return (
    <div className="space-y-3 px-4 py-2 sm:px-5">
      {(["added", "removed"] as const).map((kind) =>
        changes[kind].length ? (
          <section className="space-y-1" key={kind}>
            <h3 className="font-medium text-sm">
              {kind === "added" ? "Added" : "Removed"}
            </h3>
            <ul className="space-y-1">
              {changes[kind].map((item) => (
                <li className="flex items-start gap-2 text-sm" key={item.id}>
                  <span
                    aria-hidden
                    className={
                      kind === "added"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {kind === "added" ? "+" : "−"}
                  </span>
                  <span className="min-w-0 break-words">
                    {item.name ||
                      (event.field === "skills"
                        ? "Unavailable skill"
                        : "Unavailable tool")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}
      {changes.added.length === 0 && changes.removed.length === 0 ? (
        <p className="text-muted-foreground text-sm">No assignments changed.</p>
      ) : null}
    </div>
  );
}

function HistoryChangeDialog({
  event,
  onOpenChange,
  open,
}: {
  event: ProfileChangeEvent | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  if (!event) {
    return null;
  }

  const file = formatFieldLabel(event.field);
  const actor = formatActorLabel(event);
  const rows = buildChangeRows(event);
  const added = rows.filter((row) => row.type === "add").length;
  const removed = rows.filter((row) => row.type === "del").length;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 gap-2 pt-4 pr-12 pb-2 pl-4 sm:pt-5 sm:pl-5">
          <div className="flex items-baseline justify-between gap-3">
            <DialogTitle className="text-balance">
              {file}
              {event.assignmentChanges ? " updated" : ""}
            </DialogTitle>
            {!event.assignmentChanges && (
              <p className="shrink-0 font-mono text-xs tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{added}
                </span>
                <span className="ml-2 text-red-600 dark:text-red-400">
                  -{removed}
                </span>
              </p>
            )}
          </div>
          <DialogDescription className="text-pretty">
            <time
              dateTime={event.createdAt}
              title={formatSessionTimestamp(event.createdAt)}
            >
              {formatSessionRelativeTime(event.createdAt)}
            </time>
            {" · "}
            {formatSourceLabel(event.source)}
            {actor ? <> · {actor}</> : null}
          </DialogDescription>
        </DialogHeader>
        {event.assignmentChanges ? (
          <div className="min-h-0 overflow-y-auto border-border border-t">
            <AssignmentChangeSummary event={event} />
            <FileDiff className="border-border border-t" rows={rows} wrap />
          </div>
        ) : (
          <FileDiff
            className="min-h-0 flex-1 border-border border-t"
            rows={rows}
            wrap
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProfileHistoryTab({ profileId }: { profileId: string }) {
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const { data, error, isLoading, refetch } = useQuery({
    queryFn: () => client.listProfileChangeHistory(profileId, { limit: 100 }),
    queryKey: queryKeys.profiles.history(profileId),
  });

  if (isLoading) {
    return (
      <p className="text-pretty text-muted-foreground text-sm">
        Loading history…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-pretty text-destructive text-sm">
        {formatError(error)}{" "}
        <Button
          className="relative h-auto p-0 after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2"
          onClick={() => void refetch()}
          type="button"
          variant="link"
        >
          Retry
        </Button>
      </p>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-pretty text-muted-foreground text-sm">
        No profile changes yet.
      </p>
    );
  }

  const openEvent = events.find((event) => event.id === openEventId) ?? null;

  return (
    <div className="space-y-3">
      <ul
        aria-label="Profile change history"
        className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      >
        {events.map((event) => {
          const actor = formatActorLabel(event);
          const rows = event.assignmentChanges ? [] : buildChangeRows(event);
          const added =
            event.assignmentChanges?.added.length ??
            rows.filter((row) => row.type === "add").length;
          const removed =
            event.assignmentChanges?.removed.length ??
            rows.filter((row) => row.type === "del").length;

          return (
            <li key={event.id}>
              <button
                aria-haspopup="dialog"
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-[background-color] duration-150 ease-out hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                onClick={() => setOpenEventId(event.id)}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {formatFieldLabel(event.field)}
                    {event.assignmentChanges ? " updated" : ""}
                  </p>
                  <p className="mt-0.5 text-pretty text-muted-foreground text-xs">
                    {formatSourceLabel(event.source)}
                    {" · "}
                    <time
                      className="tabular-nums"
                      dateTime={event.createdAt}
                      title={formatSessionTimestamp(event.createdAt)}
                    >
                      {formatSessionRelativeTime(event.createdAt)}
                    </time>
                    {actor ? <> · {actor}</> : null}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-xs tabular-nums">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {event.assignmentChanges ? `${added} added` : `+${added}`}
                  </span>
                  <span className="ml-1.5 text-red-600 dark:text-red-400">
                    {event.assignmentChanges
                      ? `${removed} removed`
                      : `-${removed}`}
                  </span>
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      <HistoryChangeDialog
        event={openEvent}
        onOpenChange={(open) => {
          if (!open) {
            setOpenEventId(null);
          }
        }}
        open={openEvent !== null}
      />
    </div>
  );
}
