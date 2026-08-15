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
  } = state;

  if (!selected) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h2 className="type-section-title min-w-0 text-balance">
              {selected.name}
            </h2>
            <AutomationStateBadge
              className="mt-px shrink-0"
              enabled={selected.enabled}
            />
          </div>
          {selected.description ? (
            <p className="type-body mt-1 line-clamp-2 text-pretty text-sm">
              {selected.description}
            </p>
          ) : null}
          <p className="type-body mt-1 text-pretty text-xs tabular-nums">
            {selectedSubtitle}
          </p>
        </div>

        <AutomationDetailActions
          automation={selected}
          busy={busy}
          className="hidden lg:flex"
          onDelete={setDeleteTarget}
          onEdit={openEdit}
          onRun={handleRun}
          runningId={runningId}
        />
      </div>

      <AutomationDetailActions
        automation={selected}
        busy={busy}
        className="mb-5 lg:hidden"
        onDelete={setDeleteTarget}
        onEdit={openEdit}
        onRun={handleRun}
        runningId={runningId}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs tabular-nums">
        <SoftPill label={`${runs.length} total`} />
        <SoftPill
          label={`${selectedRunSummary.completed} success`}
          tone="success"
        />
        <SoftPill label={`${selectedRunSummary.failed} failed`} tone="danger" />
        {selectedRunSummary.running > 0 ? (
          <SoftPill
            label={`${selectedRunSummary.running} running`}
            tone="default"
          />
        ) : null}
        {selectedRunSummary.unread > 0 ? (
          <SoftPill label={`${selectedRunSummary.unread} unread`} />
        ) : null}
      </div>

      <div className="flex flex-col border-border border-t pt-5">
        <div className="mb-4">
          <h3 className="type-section-title">Run history</h3>
          <p className="type-body mt-1 min-h-[1rem] text-xs">
            {runsLoading
              ? "Loading runs…"
              : runs.length === 0
                ? "No runs yet"
                : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {runsLoading ? (
          <ListSkeleton rows={3} />
        ) : runs.length === 0 ? (
          <div className="flex min-h-[10rem] items-center justify-center">
            <p className="type-body text-muted-foreground text-xs">
              No runs yet.
            </p>
          </div>
        ) : (
          <RunHistoryList
            busy={busy}
            onDeleteRun={setDeleteRunTarget}
            onRerun={() => void handleRun(selected.id)}
            running={runningId === selected.id}
            runs={runs}
          />
        )}
      </div>
    </div>
  );
}
