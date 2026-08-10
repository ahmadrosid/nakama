import type { OrgMemoryChangeLogEntry } from "@nakama/core/contract";
import { EyeIcon, RotateLeft01Icon, TimelineIcon } from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOrgMembers } from "@/hooks/use-org-members";
import {
  useOrgMemoryHistory,
  useOrgMemoryHistoryRevision,
  useRestoreOrgMemoryHistory,
  useUndoOrgMemoryChange,
} from "@/hooks/use-org-memory-history";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function shortenId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

function resolveActorLabel(
  userId: string | null,
  members: { userId: string; name?: string | null; email: string }[]
): string | null {
  if (!userId) {
    return null;
  }
  const member = members.find((entry) => entry.userId === userId);
  if (!member) {
    return shortenId(userId);
  }
  return member.name?.trim() || member.email;
}

function formatActionLabel(action: OrgMemoryChangeLogEntry["action"]): string {
  switch (action) {
    case "edit":
      return "Edit";
    case "approve":
      return "Approved";
    case "add_fact":
      return "Added";
    case "pin":
      return "Pinned";
    case "unpin":
      return "Unpinned";
    case "archive":
      return "Archived";
    case "restore":
      return "Restored";
    default:
      return action;
  }
}

function HistoryRevisionDialog({
  orgId,
  change,
  actorLabel,
  open,
  onOpenChange,
}: {
  orgId: string;
  change: OrgMemoryChangeLogEntry;
  actorLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } = useOrgMemoryHistoryRevision(
    orgId,
    open ? change.id : null
  );
  const absoluteTime = formatSessionTimestamp(change.createdAt);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>Memory snapshot</DialogTitle>
          <DialogDescription className="break-all">
            {change.label}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-1 text-muted-foreground text-xs">
          <p>
            <span className="font-medium text-foreground/80">
              {formatActionLabel(change.action)}
            </span>
            {" · "}
            <time dateTime={change.createdAt} title={absoluteTime}>
              {absoluteTime}
            </time>
            {actorLabel ? <> · {actorLabel}</> : null}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/30">
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-muted-foreground text-sm">
              <Spinner />
              Loading snapshot…
            </div>
          ) : error ? (
            <p className="px-3 py-4 text-destructive text-sm" role="alert">
              {formatError(error)}
            </p>
          ) : (
            <pre className="max-h-[min(52dvh,28rem)] overflow-y-auto whitespace-pre-wrap break-all px-3 py-3 font-mono text-foreground text-xs leading-relaxed">
              {data?.content ?? ""}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryTimelineItem({
  change,
  orgId,
  actorLabel,
  isCurrent,
  isLast,
}: {
  change: OrgMemoryChangeLogEntry;
  orgId: string;
  actorLabel: string | null;
  isCurrent: boolean;
  isLast: boolean;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const restoreMutation = useRestoreOrgMemoryHistory(orgId);
  const busy = restoreMutation.isPending;

  async function handleRevert() {
    try {
      await restoreMutation.mutateAsync(change.id);
      toast("Org memory reverted.");
    } catch (err) {
      toast(formatError(err));
    }
  }

  const relativeTime = formatSessionRelativeTime(change.createdAt);
  const absoluteTime = formatSessionTimestamp(change.createdAt);

  return (
    <>
      <div className="flex gap-3">
        <div className="flex flex-col items-center self-stretch">
          <div
            aria-hidden
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border",
              isCurrent
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-muted text-muted-foreground"
            )}
          >
            <TimelineIcon className="size-3.5" strokeWidth={2.25} />
          </div>
          {isLast ? null : <div className="mt-2 w-px flex-1 bg-border" />}
        </div>

        <div
          className={cn("min-w-0 flex-1 overflow-hidden", !isLast && "pb-4")}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-[0.08em]">
                  {formatActionLabel(change.action)}
                </span>
                {isCurrent ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[0.65rem] text-foreground">
                    Current
                  </span>
                ) : null}
              </div>
              <p className="break-all text-foreground text-sm leading-relaxed">
                {change.label}
              </p>
              <p className="text-muted-foreground text-xs">
                <time dateTime={change.createdAt} title={absoluteTime}>
                  {relativeTime}
                </time>
                {actorLabel ? <> · {actorLabel}</> : null}
              </p>
            </div>

            <div className="flex shrink-0 gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="View snapshot"
                      onClick={() => setViewOpen(true)}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <EyeIcon aria-hidden className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent side="top" sideOffset={8}>
                  View
                </TooltipContent>
              </Tooltip>
              {isCurrent ? null : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="Revert to this snapshot"
                        disabled={busy}
                        onClick={() => void handleRevert()}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        {busy ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <RotateLeft01Icon aria-hidden className="size-3.5" />
                        )}
                      </Button>
                    }
                  />
                  <TooltipContent side="top" sideOffset={8}>
                    Revert
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      <HistoryRevisionDialog
        actorLabel={actorLabel}
        change={change}
        onOpenChange={setViewOpen}
        open={viewOpen}
        orgId={orgId}
      />
    </>
  );
}

export function OrgMemoryHistoryPanel({ orgId }: { orgId: string }) {
  const { data, isLoading, error } = useOrgMemoryHistory(orgId);
  const undoMutation = useUndoOrgMemoryChange(orgId);
  const { data: membersData } = useOrgMembers(orgId);
  const changes = data?.changes ?? [];
  const members = membersData?.members ?? [];
  const canUndo = changes.length >= 2;

  async function handleUndo() {
    try {
      await undoMutation.mutateAsync();
      toast("Latest org memory change undone.");
    } catch (err) {
      toast(formatError(err));
    }
  }

  if (isLoading) {
    return (
      <p className="px-4 py-2 text-muted-foreground text-xs">
        Loading history…
      </p>
    );
  }

  if (error) {
    return (
      <p className="px-4 py-2 text-destructive text-sm" role="alert">
        {formatError(error)}
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2">
        <p className="text-muted-foreground text-xs">
          Timeline of every change. View snapshots or revert to an earlier
          revision.
        </p>
        <Button
          disabled={!canUndo || undoMutation.isPending}
          onClick={() => void handleUndo()}
          size="sm"
          type="button"
          variant="outline"
        >
          {undoMutation.isPending ? <Spinner className="mr-2" /> : null}
          Undo latest
        </Button>
      </div>

      {changes.length === 0 ? (
        <p className="px-4 py-3 text-muted-foreground text-xs">
          No changes logged yet.
        </p>
      ) : (
        <div className="min-w-0 px-4 py-3">
          {changes.map((change, index) => (
            <HistoryTimelineItem
              actorLabel={resolveActorLabel(change.actorUserId, members)}
              change={change}
              isCurrent={index === 0}
              isLast={index === changes.length - 1}
              key={change.id}
              orgId={orgId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
