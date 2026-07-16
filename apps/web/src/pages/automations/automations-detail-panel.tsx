import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatFutureRelativeTime, formatSessionRelativeTime } from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import {
  AutomationDetailActions,
  AutomationPanelPlaceholder,
  AutomationStateBadge,
  ListSkeleton,
  MetaStat,
  RunHistoryList,
  SoftPill,
} from "@/pages/automations/automations-components";
import { runHistoryScrollClass } from "@/pages/automations/automations-page.shared";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

export function AutomationsDetailPanel({
  state,
}: {
  state: AutomationsPageState;
}) {
  const {
    automations,
    loading,
    selected,
    selectedSubtitle,
    busy,
    runningId,
    handleRun,
    openEdit,
    setDeleteTarget,
    selectedRunSummary,
    runs,
    runsLoading,
    setDeleteRunTarget,
    refetchRuns,
  } = state;

  if (loading) {
    return null;
  }

  if (automations.length === 0) {
    return null;
  }

  if (!selected) {
    return (
      <AutomationPanelPlaceholder>
        Select an automation to view runs.
      </AutomationPanelPlaceholder>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-h-[4.75rem] min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-section-title">{selected.name}</h2>
            <AutomationStateBadge enabled={selected.enabled} />
          </div>
          <p
            className={cn(
              "type-body mt-1 line-clamp-2 min-h-[2.5rem] text-sm",
              selected.description ? "text-foreground" : "text-transparent",
            )}
          >
            {selected.description || "No description"}
          </p>
          <p className="type-body mt-1 text-xs">{selectedSubtitle}</p>
        </div>

        <AutomationDetailActions
          automation={selected}
          busy={busy}
          runningId={runningId}
          onRun={handleRun}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          className="hidden lg:flex"
        />
      </div>

      <AutomationDetailActions
        automation={selected}
        busy={busy}
        runningId={runningId}
        onRun={handleRun}
        onEdit={openEdit}
        onDelete={setDeleteTarget}
        className="mb-5 lg:hidden"
      />

      <div className="mb-5 grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetaStat
          label="Trigger"
          value={selected.trigger.type === "manual" ? "Manual" : "Scheduled"}
          tone="default"
        />
        <MetaStat
          label="Next run"
          value={selected.nextRunAt ? formatFutureRelativeTime(selected.nextRunAt) : "Not scheduled"}
          tone="default"
        />
        <MetaStat
          label="Last run"
          value={selected.lastRunAt ? formatSessionRelativeTime(selected.lastRunAt) : "No runs yet"}
          tone="default"
        />
        <MetaStat
          label="Unread runs"
          value={String(selectedRunSummary.unread)}
          tone={selectedRunSummary.unread > 0 ? "attention" : "default"}
        />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <SoftPill label={`${runs.length} total`} />
        <SoftPill label={`${selectedRunSummary.completed} success`} tone="success" />
        <SoftPill label={`${selectedRunSummary.failed} failed`} tone="danger" />
        {selectedRunSummary.running > 0 ? (
          <SoftPill label={`${selectedRunSummary.running} running`} tone="default" />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-5">
        <div className="mb-4 flex h-10 shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="type-section-title">Run history</h3>
            <p className="type-body mt-1 min-h-[1rem] text-xs">
              {runsLoading
                ? "Loading runs…"
                : runs.length === 0
                  ? "No runs yet"
                  : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            disabled={runsLoading || busy}
            aria-label="Refresh run history"
            onClick={() => void refetchRuns()}
          >
            {runsLoading ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCwIcon className="size-4" aria-hidden />
            )}
          </Button>
        </div>

        <div className={runHistoryScrollClass}>
          {runsLoading ? (
            <ListSkeleton rows={3} />
          ) : runs.length === 0 ? (
            <div className="flex min-h-[10rem] items-center justify-center">
              <p className="type-body text-xs text-muted-foreground">No runs yet.</p>
            </div>
          ) : (
            <RunHistoryList runs={runs} busy={busy} onDeleteRun={setDeleteRunTarget} />
          )}
        </div>
      </div>

      <div className="type-body mt-5 shrink-0 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
        <p className="font-medium text-foreground">How it works</p>
        <p className="mt-2">
          Run now triggers a manual execution. Scheduled automations run automatically when
          enabled.
        </p>
      </div>
    </div>
  );
}
