import type { StoredAutomation } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { cn } from "@nakama/ui/utils";
import { formatFutureRelativeTime } from "@/lib/chat-history";
import {
  ListSkeleton,
  RunHistoryList,
} from "@/pages/automations/automations-components";
import { describeTrigger } from "@/pages/automations/automations-page.shared";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

type DetailState = Pick<
  AutomationsPageState,
  | "selected"
  | "busy"
  | "runningId"
  | "handleRun"
  | "handleToggleEnabled"
  | "openEdit"
  | "setDeleteTarget"
  | "selectedProfileName"
  | "selectedRunSummary"
  | "runs"
  | "runsLoading"
>;

function Fact({
  label,
  value,
  note,
  noteClassName,
}: {
  label: string;
  value: string;
  note?: string;
  noteClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-[15px]">{value}</p>
      {note ? (
        <p
          className={cn("mt-0.5 text-muted-foreground text-xs", noteClassName)}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

function AutomationSummaryCard({
  selected,
  busy,
  runningId,
  handleRun,
  handleToggleEnabled,
  openEdit,
  setDeleteTarget,
  selectedProfileName,
  selectedRunSummary,
  runCount,
}: Pick<
  DetailState,
  | "busy"
  | "runningId"
  | "handleRun"
  | "handleToggleEnabled"
  | "openEdit"
  | "setDeleteTarget"
  | "selectedProfileName"
  | "selectedRunSummary"
> & { selected: StoredAutomation; runCount: number }) {
  const schedule = describeTrigger(selected.trigger);
  const { completed, failed } = selectedRunSummary;

  const nextRun = selected.nextRunAt
    ? formatFutureRelativeTime(selected.nextRunAt)
    : "Not scheduled";

  return (
    <Card className="overflow-hidden shadow-none">
      <CardContent className="space-y-4 p-0">
        <div className="space-y-4 px-5 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="min-w-0 text-balance font-semibold text-lg">
                {selected.name}
              </h2>
              {selected.description ? (
                <p className="type-body mt-1 text-pretty text-sm">
                  {selected.description}
                </p>
              ) : null}
            </div>
            <label className="flex shrink-0 items-center gap-2 font-medium text-sm">
              {selected.enabled ? "On" : "Off"}
              <Switch
                aria-label="Automation on"
                checked={selected.enabled}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  void handleToggleEnabled(selected, enabled)
                }
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Fact label="Runs" note={schedule.note} value={schedule.label} />
            <Fact
              label="Next run"
              value={nextRun.charAt(0).toUpperCase() + nextRun.slice(1)}
            />
            <Fact
              label="Results"
              note={failed > 0 ? `${failed} had problems` : undefined}
              noteClassName="text-amber-700 dark:text-amber-400"
              value={
                runCount === 0
                  ? "No runs yet"
                  : `${completed} of ${runCount} worked`
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-border border-t bg-muted/30 px-5 py-3">
          <Button
            className="px-3.5"
            disabled={busy}
            onClick={() => openEdit(selected)}
            size="lg"
            type="button"
            variant="outline"
          >
            Edit
          </Button>
          <Button
            className="px-3.5"
            disabled={busy || runningId !== null}
            onClick={() => void handleRun(selected.id)}
            size="lg"
            type="button"
          >
            {runningId === selected.id ? (
              <Spinner className="size-3.5" />
            ) : null}
            Run now
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <p className="text-muted-foreground text-sm">
              Done by{" "}
              <span className="font-medium text-foreground">
                {selectedProfileName}
              </span>
            </p>
            <Button
              className="px-3.5 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setDeleteTarget(selected)}
              size="lg"
              type="button"
              variant="ghost"
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AutomationDetailPanel(state: DetailState) {
  const {
    selected,
    busy,
    runningId,
    handleRun,
    handleToggleEnabled,
    openEdit,
    setDeleteTarget,
    selectedProfileName,
    selectedRunSummary,
    runs,
    runsLoading,
  } = state;

  if (!selected) {
    return null;
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-8">
      <AutomationSummaryCard
        busy={busy}
        handleRun={handleRun}
        handleToggleEnabled={handleToggleEnabled}
        openEdit={openEdit}
        runCount={runs.length}
        runningId={runningId}
        selected={selected}
        selectedProfileName={selectedProfileName}
        selectedRunSummary={selectedRunSummary}
        setDeleteTarget={setDeleteTarget}
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-normal text-muted-foreground/55 text-sm">
            Run history
          </h3>
          <p className="type-body text-xs">
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
          <Card className="min-h-[10rem] items-center justify-center shadow-none">
            <p className="type-body text-muted-foreground text-xs">
              No runs yet.
            </p>
          </Card>
        ) : (
          <RunHistoryList
            busy={busy}
            onRerun={() => void handleRun(selected.id)}
            profileId={selected.profileId}
            running={runningId === selected.id}
            runs={runs}
          />
        )}
      </section>
    </div>
  );
}
