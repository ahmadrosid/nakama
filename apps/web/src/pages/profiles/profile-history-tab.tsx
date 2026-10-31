import type { ProfileChangeEvent } from "@nakama/core";
import { Button } from "@nakama/ui/button";
import { Dialog, DialogSheetContent, DialogTitle } from "@nakama/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft01Icon } from "hugeicons-react";
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
    case "super_nakama":
      return "Super Nakama";
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

function HistoryChangeDetail({
  event,
  onBack,
}: {
  event: ProfileChangeEvent;
  onBack: () => void;
}) {
  const file = formatFieldLabel(event.field);
  const actor = formatActorLabel(event);
  const rows = buildChangeRows(event);
  const added = rows.filter((row) => row.type === "add").length;
  const removed = rows.filter((row) => row.type === "del").length;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-start gap-2 border-border border-b py-3 pr-6 pl-3">
        <Button
          aria-label="Back to change history"
          className="min-h-10 min-w-10 shrink-0"
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft01Icon aria-hidden className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 pt-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-medium text-sm">
              {file}
              {event.assignmentChanges ? " updated" : ""}
            </h3>
            {event.assignmentChanges ? null : (
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
          <p className="mt-0.5 text-pretty text-muted-foreground text-xs">
            <time
              dateTime={event.createdAt}
              title={formatSessionTimestamp(event.createdAt)}
            >
              {formatSessionRelativeTime(event.createdAt)}
            </time>
            {" · "}
            {formatSourceLabel(event.source)}
            {actor ? <> · {actor}</> : null}
          </p>
        </div>
      </div>
      {event.assignmentChanges ? (
        <AssignmentChangeSummary event={event} />
      ) : null}
      <FileDiff rows={rows} wrap />
    </div>
  );
}

function ProfileHistoryList({ profileId }: { profileId: string }) {
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  const { data, error, isLoading, refetch } = useQuery({
    queryFn: () => client.listProfileChangeHistory(profileId, { limit: 100 }),
    queryKey: queryKeys.profiles.history(profileId),
  });

  if (isLoading) {
    return (
      <p className="text-pretty px-5 py-4 text-muted-foreground text-sm">
        Loading history…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-pretty px-5 py-4 text-destructive text-sm">
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
      <p className="text-pretty px-5 py-4 text-muted-foreground text-sm">
        No profile changes yet.
      </p>
    );
  }

  const openEvent = events.find((event) => event.id === openEventId) ?? null;

  if (openEvent) {
    return (
      <HistoryChangeDetail
        event={openEvent}
        onBack={() => setOpenEventId(null)}
      />
    );
  }

  return (
    <ul aria-label="Profile change history" className="divide-y divide-border">
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
              className="flex w-full cursor-pointer items-center gap-3 px-6 py-3.5 text-left transition-[background-color] duration-150 ease-out hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
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
  );
}

export function ProfileHistorySheet({
  onOpenChange,
  open,
  profileId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  profileId: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogSheetContent closeLabel="Close change history">
        <header className="flex h-12 shrink-0 items-center border-border border-b pr-14 pl-5">
          <DialogTitle className="font-medium text-sm">
            Change history
          </DialogTitle>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {open ? <ProfileHistoryList profileId={profileId} /> : null}
        </div>
      </DialogSheetContent>
    </Dialog>
  );
}
