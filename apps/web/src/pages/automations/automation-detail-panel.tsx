import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  AutomationDetailActions,
  AutomationStateBadge,
  ListSkeleton,
  RunHistoryList,
  SoftPill,
} from "@/pages/automations/automations-components";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

type DetailState = Pick<
  AutomationsPageState,
  | "selected"
  | "busy"
  | "runningId"
  | "handleRun"
  | "openEdit"
  | "setDeleteTarget"
  | "selectedSubtitle"
  | "selectedRunSummary"
  | "runs"
  | "runsLoading"
  | "setDeleteRunTarget"
  | "refetchRuns"
>;

export function AutomationDetailPanel(state: DetailState) {
  const {
    selected,
    busy,
    runningId,
    handleRun,
    openEdit,
    setDeleteTarget,
    selectedSubtitle,
    selectedRunSummary,
    runs,
    runsLoading,
    setDeleteRunTarget,
    refetchRuns,
  } = state;

  if (!selected) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <SoftPill label={`${runs.length} total`} />
        <SoftPill label={`${selectedRunSummary.completed} success`} tone="success" />
        <SoftPill label={`${selectedRunSummary.failed} failed`} tone="danger" />
        {selectedRunSummary.running > 0 ? (
          <SoftPill label={`${selectedRunSummary.running} running`} tone="default" />
        ) : null}
        {selectedRunSummary.unread > 0 ? (
          <SoftPill label={`${selectedRunSummary.unread} unread`} />
        ) : null}
      </div>

      <div className="flex flex-col border-t border-border pt-5">
        <div className="mb-4 flex h-10 items-center justify-between gap-3">
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
  );
}
