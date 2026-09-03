import type {
  StoredWorkflow,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
} from "@nakama/core/contract";
import { PlayIcon, RefreshIcon } from "hugeicons-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import {
  useDeleteWorkflowMutation,
  useDeleteWorkflowRunMutation,
  useRunWorkflowMutation,
  useUpdateWorkflowMutation,
  useWorkflowRunsQuery,
  useWorkflowsQuery,
} from "@/hooks/use-workflows";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { agentWorkPanelClassName } from "@/pages/automations/automations-page.shared";

export function WorkflowsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const {
    data: workflows = [],
    isLoading,
    isFetching,
    refetch,
    error: workflowsError,
  } = useWorkflowsQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    workflows.find((workflow) => workflow.id === selectedId) ??
    workflows[0] ??
    null;
  const activeId = selected?.id ?? null;
  const {
    data: runs = [],
    isLoading: runsLoading,
    refetch: refetchRuns,
  } = useWorkflowRunsQuery(activeId);
  const runMutation = useRunWorkflowMutation();
  const updateMutation = useUpdateWorkflowMutation();
  const deleteMutation = useDeleteWorkflowMutation();
  const deleteRunMutation = useDeleteWorkflowRunMutation();
  const [pageError, setPageError] = useState<string | null>(null);

  const busy =
    runMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    deleteRunMutation.isPending;

  const selectedSubtitle = useMemo(() => {
    if (!selected) {
      return "";
    }
    return `${selected.steps.length} steps · ${selected.enabled ? "Enabled" : "Disabled"}`;
  }, [selected]);

  async function handleRun(workflow: StoredWorkflow) {
    setPageError(null);
    try {
      await runMutation.mutateAsync({ workflowId: workflow.id });
      await refetchRuns();
    } catch (error) {
      setPageError(formatError(error));
    }
  }

  async function toggleEnabled(workflow: StoredWorkflow, enabled: boolean) {
    setPageError(null);
    try {
      await updateMutation.mutateAsync({
        input: { enabled },
        workflowId: workflow.id,
      });
    } catch (error) {
      setPageError(formatError(error));
    }
  }

  return (
    <div className={agentWorkPanelClassName}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {(pageError || workflowsError) && (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm"
            role="alert"
          >
            {pageError ?? formatError(workflowsError)}
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-lg border border-border">
            <div className="flex items-center justify-between border-border border-b px-3 py-3">
              <h2 className="font-medium text-sm">Workflows</h2>
              <Button
                aria-label="Refresh workflows"
                disabled={busy || isFetching}
                onClick={() => void refetch()}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {isFetching ? (
                  <Spinner className="size-4" />
                ) : (
                  <RefreshIcon className="size-4" />
                )}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {isLoading ? (
                <p className="p-4 text-muted-foreground text-sm">Loading…</p>
              ) : workflows.length === 0 ? (
                <div className="space-y-3 p-4 text-sm">
                  <p className="text-muted-foreground">No workflows yet.</p>
                  <Button
                    onClick={() =>
                      navigateToNewChat(null, {
                        draft:
                          "Create a morning brief workflow with fetch, compare, and summarize steps.",
                      })
                    }
                    size="sm"
                    type="button"
                  >
                    Create in chat
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {workflows.map((workflow) => (
                    <li key={workflow.id}>
                      <button
                        className={`w-full px-3 py-3 text-left hover:bg-muted/50 ${activeId === workflow.id ? "bg-muted/60" : ""}`}
                        onClick={() => setSelectedId(workflow.id)}
                        type="button"
                      >
                        <div className="font-medium text-sm">
                          {workflow.name}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {workflow.steps.length} steps
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto rounded-lg border border-border p-4">
            {selected ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="type-section-title">{selected.name}</h2>
                    {selected.description ? (
                      <p className="mt-1 text-sm">{selected.description}</p>
                    ) : null}
                    <p className="mt-1 text-muted-foreground text-xs">
                      {selectedSubtitle}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={selected.enabled}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          void toggleEnabled(selected, checked)
                        }
                      />
                      Enabled
                    </label>
                    <Button
                      disabled={busy || !selected.enabled}
                      onClick={() => void handleRun(selected)}
                      size="sm"
                      type="button"
                    >
                      <PlayIcon className="size-4" />
                      Run now
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 font-medium text-sm">Steps</h3>
                  <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">
                    {JSON.stringify(selected.steps, null, 2)}
                  </pre>
                </div>

                <div>
                  <h3 className="mb-2 font-medium text-sm">Run history</h3>
                  {runsLoading ? (
                    <p className="text-muted-foreground text-sm">
                      Loading runs…
                    </p>
                  ) : runs.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No runs yet.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {runs.map((run) => (
                        <WorkflowRunCard
                          key={run.id}
                          onDelete={() =>
                            void deleteRunMutation.mutateAsync({
                              runId: run.id,
                              workflowId: selected.id,
                            })
                          }
                          run={run}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Select a workflow.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function WorkflowRunCard({
  run,
  onDelete,
}: {
  run: WorkflowRunRecord;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-sm capitalize">{run.status}</div>
          <div className="text-muted-foreground text-xs">
            {formatSessionRelativeTime(run.startedAt)}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setOpen((value) => !value)}
            size="sm"
            type="button"
            variant="outline"
          >
            {open ? "Hide receipts" : "Show receipts"}
          </Button>
          <Button onClick={onDelete} size="sm" type="button" variant="ghost">
            Delete
          </Button>
        </div>
      </div>
      {run.output ? (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs">
          {run.output}
        </pre>
      ) : null}
      {run.error ? (
        <p className="mt-2 text-destructive text-sm">{run.error}</p>
      ) : null}
      {open && run.steps && run.steps.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {run.steps.map((step) => (
            <WorkflowStepReceipt key={step.id} step={step} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function WorkflowStepReceipt({ step }: { step: WorkflowRunStepRecord }) {
  return (
    <li className="rounded border border-border/70 p-2 text-xs">
      <div className="font-medium">
        {step.stepId} · {step.kind} · {step.status}
      </div>
      {step.output == null ? null : (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(step.output, null, 2)}
        </pre>
      )}
      {step.error ? (
        <p className="mt-1 text-destructive">{step.error}</p>
      ) : null}
    </li>
  );
}
