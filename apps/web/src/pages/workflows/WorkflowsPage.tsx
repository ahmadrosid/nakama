import type { StoredWorkflow } from "@nakama/core/contract";
import { parseUnknownWorkflowToolError } from "@nakama/core/workflow-ops";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useDeleteWorkflowMutation,
  useRunWorkflowMutation,
  useUpdateWorkflowMutation,
  useWorkflowRunsQuery,
  useWorkflowsQuery,
} from "@/hooks/use-workflows";
import { formatError } from "@/lib/client";
import { agentWorkPanelClassName } from "@/pages/automations/automations-page.shared";
import { WorkflowBuilder } from "@/pages/workflows/workflow-builder";

export function WorkflowsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const {
    data: workflows = [],
    isLoading,
    error: workflowsError,
  } = useWorkflowsQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    workflows.find((workflow) => workflow.id === selectedId) ??
    workflows[0] ??
    null;
  const activeId = selected?.id ?? null;
  const { data: runs = [], refetch: refetchRuns } =
    useWorkflowRunsQuery(activeId);
  const runMutation = useRunWorkflowMutation();
  const updateMutation = useUpdateWorkflowMutation();
  const deleteMutation = useDeleteWorkflowMutation();
  const [pageError, setPageError] = useState<string | null>(null);

  const busy =
    runMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

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

  async function handleSave(
    workflow: StoredWorkflow,
    input: { description: string; name: string; steps: StoredWorkflow["steps"] }
  ) {
    setPageError(null);
    try {
      await updateMutation.mutateAsync({
        input,
        workflowId: workflow.id,
      });
    } catch (error) {
      setPageError(formatError(error));
    }
  }

  async function handleDelete(workflow: StoredWorkflow) {
    setPageError(null);
    try {
      await deleteMutation.mutateAsync(workflow.id);
      setSelectedId(null);
    } catch (error) {
      setPageError(formatError(error));
    }
  }

  async function handleProfileChange(
    workflow: StoredWorkflow,
    profileId: string
  ) {
    if (!profileId || profileId === workflow.profileId) {
      return;
    }
    setPageError(null);
    try {
      await updateMutation.mutateAsync({
        input: { profileId },
        workflowId: workflow.id,
      });
    } catch (error) {
      const message = formatError(error);
      if (!parseUnknownWorkflowToolError(message)) {
        setPageError(message);
      }
      throw error;
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
            <div className="border-border border-b px-3 py-3">
              <h2 className="font-medium text-sm">Workflows</h2>
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
                          {workflow.steps.length} steps ·{" "}
                          {profileById.get(workflow.profileId)?.name ??
                            workflow.profileId}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
            {selected ? (
              <WorkflowBuilder
                busy={busy}
                key={`${selected.id}:${selected.updatedAt}`}
                onDelete={() => void handleDelete(selected)}
                onProfileChange={(profileId) =>
                  handleProfileChange(selected, profileId)
                }
                onRun={() => void handleRun(selected)}
                onSave={(input) => handleSave(selected, input)}
                onToggleEnabled={(enabled) =>
                  void toggleEnabled(selected, enabled)
                }
                profileById={profileById}
                profiles={profiles}
                runs={runs}
                workflow={selected}
              />
            ) : (
              <p className="p-4 text-muted-foreground text-sm">
                Select a workflow.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
