import type {
  ProfileSummary,
  StoredWorkflow,
  WorkflowRunRecord,
} from "@nakama/core/contract";
import { parseUnknownWorkflowToolError } from "@nakama/core/workflow-ops";
import { Message01Icon, WorkflowSquare01Icon } from "hugeicons-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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
import { cn } from "@/lib/utils";
import { sectionClass } from "@/pages/automations/automations-page.shared";
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
  const [deleteTarget, setDeleteTarget] = useState<StoredWorkflow | null>(null);

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
      throw error;
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || busy) {
      return;
    }
    setPageError(null);
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
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

  function goToCreateWorkflow() {
    navigateToNewChat(null, {
      draft:
        "Create a morning brief workflow with fetch, compare, and summarize steps.",
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      {pageError || workflowsError ? (
        <p
          className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm"
          role="alert"
        >
          {pageError ?? formatError(workflowsError)}
        </p>
      ) : null}

      <WorkflowsPageLayout
        activeId={activeId}
        busy={busy}
        isLoading={isLoading}
        onCreate={goToCreateWorkflow}
        onDelete={() => {
          if (selected) {
            setDeleteTarget(selected);
          }
        }}
        onProfileChange={(profileId) => {
          if (!selected) {
            return Promise.resolve();
          }
          return handleProfileChange(selected, profileId);
        }}
        onRun={() => {
          if (selected) {
            void handleRun(selected);
          }
        }}
        onSave={(input) => {
          if (!selected) {
            return Promise.resolve();
          }
          return handleSave(selected, input);
        }}
        onSelect={setSelectedId}
        onToggleEnabled={(enabled) => {
          if (selected) {
            void toggleEnabled(selected, enabled);
          }
        }}
        profileById={profileById}
        profiles={profiles}
        runs={runs}
        selected={selected}
        workflows={workflows}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete workflow?</DialogTitle>
            <DialogDescription>
              This removes{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>{" "}
              and its run history permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
              type="button"
              variant="destructive"
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkflowsPageLayout({
  activeId,
  busy,
  isLoading,
  onCreate,
  onDelete,
  onProfileChange,
  onRun,
  onSave,
  onSelect,
  onToggleEnabled,
  profileById,
  profiles,
  runs,
  selected,
  workflows,
}: {
  activeId: string | null;
  busy: boolean;
  isLoading: boolean;
  onCreate: () => void;
  onDelete: () => void;
  onProfileChange: (profileId: string) => Promise<void>;
  onRun: () => void;
  onSave: (input: {
    description: string;
    name: string;
    steps: StoredWorkflow["steps"];
  }) => Promise<void>;
  onSelect: (workflowId: string) => void;
  onToggleEnabled: (enabled: boolean) => void;
  profileById: Map<string, ProfileSummary>;
  profiles: ProfileSummary[];
  runs: WorkflowRunRecord[];
  selected: StoredWorkflow | null;
  workflows: StoredWorkflow[];
}) {
  return (
    <section
      className={cn(
        sectionClass,
        "flex min-h-0 flex-1 flex-col overflow-hidden"
      )}
    >
      <div className="flex shrink-0 flex-col gap-3 border-border border-b p-4 lg:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            disabled={busy || workflows.length === 0}
            onValueChange={(value) => {
              if (value) {
                onSelect(String(value));
              }
            }}
            value={activeId ?? ""}
          >
            <SelectTrigger
              aria-label="Selected workflow"
              className="min-w-0 flex-1"
            >
              <SelectValue placeholder="Select workflow" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={onCreate} size="sm" type="button">
            <Message01Icon aria-hidden className="size-4" />
            Create workflow
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 min-w-0 flex-col border-border border-b lg:flex lg:border-r lg:border-b-0">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <WorkflowListSkeleton />
            ) : workflows.length === 0 ? (
              <div className="flex min-h-[12rem] items-center justify-center">
                <WorkflowsEmptyState />
              </div>
            ) : (
              <ul className="divide-y divide-border border-border border-b">
                {workflows.map((workflow) => (
                  <li key={workflow.id}>
                    <WorkflowListItem
                      onSelect={() => onSelect(workflow.id)}
                      profileName={
                        profileById.get(workflow.profileId)?.name ??
                        workflow.profileId
                      }
                      selected={activeId === workflow.id}
                      workflow={workflow}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-12">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <WorkflowsEmptyState />
              <Button onClick={onCreate} size="sm" type="button">
                Create workflow
              </Button>
            </div>
          ) : selected ? (
            <WorkflowBuilder
              busy={busy}
              key={selected.id}
              onDelete={onDelete}
              onProfileChange={onProfileChange}
              onRun={onRun}
              onSave={onSave}
              onToggleEnabled={onToggleEnabled}
              profileById={profileById}
              profiles={profiles}
              runs={runs}
              workflow={selected}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <p className="type-body text-muted-foreground">
                Select a workflow.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function WorkflowListItem({
  onSelect,
  profileName,
  selected,
  workflow,
}: {
  onSelect: () => void;
  profileName: string;
  selected: boolean;
  workflow: StoredWorkflow;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
        "hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:outline-none",
        selected && "bg-muted/35"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate font-medium text-foreground text-sm">
          {workflow.name}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          {workflow.steps.length} steps · {profileName}
        </p>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "inline-block size-2 rounded-full",
              workflow.enabled ? "bg-emerald-500" : "bg-muted-foreground/50"
            )}
          />
          <p className="text-2xs text-muted-foreground">
            {workflow.enabled ? "Enabled" : "Disabled"}
          </p>
        </div>
      </div>
    </button>
  );
}

function WorkflowsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40">
        <WorkflowSquare01Icon
          aria-hidden
          className="size-5 text-muted-foreground"
        />
      </div>
      <div className="space-y-1">
        <p className="type-section-title">No workflows yet</p>
        <p className="type-body text-muted-foreground">
          Ask the agent in Chat to create a multi-step workflow for you.
        </p>
      </div>
    </div>
  );
}

function WorkflowListSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading workflows"
      className="min-h-[12rem] space-y-2 px-2 pb-2"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          className="flex items-start gap-3 rounded-md px-3 py-3"
          key={index}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
            <div className="h-3 w-14 animate-pulse rounded bg-muted/35" />
          </div>
        </div>
      ))}
    </div>
  );
}
