import type {
  ProfileSummary,
  StoredWorkflow,
  ToolSummary,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowSqlitePreview,
  WorkflowStep,
} from "@nakama/core/contract";
import {
  missingWorkflowTools,
  parseUnknownWorkflowToolError,
} from "@nakama/core/workflow-ops";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  Add01Icon,
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  Cancel01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PlayIcon,
} from "hugeicons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/use-auth";
import {
  profileQueryOptions,
  useProfileQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import { useAssignToolMutation } from "@/hooks/use-resource-mutations";
import { useWorkflowSqliteQuery } from "@/hooks/use-workflows";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

const iconHitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

const stepCardSurface =
  "shadow-sm ring-1 ring-border/80 transition-[box-shadow,background-color] duration-150 ease-out dark:shadow-none";

type WorkflowDatabaseUi = {
  collapse: () => void;
  expand: () => void;
  expanded: boolean;
  queueSql: (sql: string) => void;
  setTable: (table: string | null) => void;
  sqlDraft: string | null;
  table: string | null;
  takeSqlDraft: () => string | null;
};

const useWorkflowDatabaseUi = create<WorkflowDatabaseUi>((set, get) => ({
  collapse: () => set({ expanded: false }),
  expand: () => set({ expanded: true }),
  expanded: false,
  queueSql: (sql) => set({ sqlDraft: sql }),
  setTable: (table) => set({ table }),
  sqlDraft: null,
  table: null,
  takeSqlDraft: () => {
    const sql = get().sqlDraft;
    if (sql) {
      set({ sqlDraft: null });
    }
    return sql;
  },
}));

export function WorkflowBuilder({
  busy,
  onDelete,
  onProfileChange,
  onRun,
  onSave,
  onToggleEnabled,
  profileById,
  profiles,
  runs,
  workflow,
}: {
  busy: boolean;
  onDelete: () => void;
  onProfileChange: (profileId: string) => Promise<void>;
  onRun: () => void;
  onSave: (input: {
    description: string;
    name: string;
    steps: WorkflowStep[];
  }) => Promise<void>;
  onToggleEnabled: (enabled: boolean) => void;
  profileById: Map<string, ProfileSummary>;
  profiles: ProfileSummary[];
  runs: WorkflowRunRecord[];
  workflow: StoredWorkflow;
}) {
  const [name, setName] = useState(() => workflow.name);
  const [description, setDescription] = useState(() => workflow.description);
  const [steps, setSteps] = useState(() => workflow.steps);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"configure" | "database" | "test">(
    "configure"
  );
  const [inputError, setInputError] = useState<string | null>(null);
  const sqlDraft = useWorkflowDatabaseUi((state) => state.sqlDraft);
  const collapseDatabase = useWorkflowDatabaseUi((state) => state.collapse);
  const takeSqlDraft = useWorkflowDatabaseUi((state) => state.takeSqlDraft);
  const { data: profile } = useProfileQuery(workflow.profileId);
  const tools = profile?.tools ?? [];
  const profileSwitch = useWorkflowProfileSwitch({
    onProfileChange,
    profileById,
    steps,
    workflowProfileId: workflow.profileId,
  });
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    if (
      name === workflow.name &&
      description === workflow.description &&
      JSON.stringify(steps) === JSON.stringify(workflow.steps)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void saveRef.current({ description, name, steps }).catch(() => undefined);
    }, 700);
    return () => {
      clearTimeout(timer);
    };
  }, [
    description,
    name,
    steps,
    workflow.description,
    workflow.name,
    workflow.steps,
  ]);

  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? null;
  const selectedIndex = selectedStep
    ? steps.findIndex((step) => step.id === selectedStep.id)
    : -1;

  useEffect(() => () => collapseDatabase(), [collapseDatabase, workflow.id]);

  useEffect(() => {
    if (!sqlDraft) {
      return;
    }
    const sql = takeSqlDraft();
    if (!sql) {
      return;
    }
    setSteps((current) =>
      current.map((step) =>
        step.id === selectedStepId && step.kind === "tool"
          ? { ...step, input: { ...step.input, sql } }
          : step
      )
    );
    setPanelTab("configure");
  }, [selectedStepId, sqlDraft, takeSqlDraft]);

  function patchStep(stepId: string, next: WorkflowStep) {
    setSteps((current) =>
      current.map((step) => (step.id === stepId ? next : step))
    );
  }

  function renameStep(step: WorkflowStep, nextId: string) {
    const id = nextId.trim();
    if (!id) {
      return;
    }
    patchStep(step.id, { ...step, id });
    if (selectedStepId === step.id) {
      setSelectedStepId(id);
    }
  }

  function addToolStep(input: Record<string, unknown>, tool: string) {
    const inserted = insertDataStep(steps, input, tool);
    setSteps(inserted.steps);
    setSelectedStepId(inserted.id);
    setPanelTab(tool === "sqlite" ? "database" : "configure");
  }

  function deleteStep(stepId: string) {
    const remaining = removeWorkflowStep(steps, stepId);
    if (!remaining) {
      return;
    }
    setSteps(remaining);
    if (selectedStepId === stepId) {
      setSelectedStepId(remaining[0]?.id ?? null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowBuilderHeader
        busy={busy}
        enabled={workflow.enabled}
        name={name}
        onDelete={onDelete}
        onRun={onRun}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 overflow-y-auto p-5">
          <WorkflowBuilderMeta
            busy={busy}
            description={description}
            enabled={workflow.enabled}
            name={name}
            onDescriptionChange={setDescription}
            onNameChange={setName}
            onProfileChange={profileSwitch.selectProfile}
            onToggleEnabled={onToggleEnabled}
            profile={profileById.get(workflow.profileId)}
            profileDisabled={profileSwitch.busy}
            profileId={workflow.profileId}
            profiles={profiles}
          />
          <WorkflowStepList
            busy={busy}
            onAdd={() => addToolStep({ url: "" }, "web_fetch")}
            onAddDatabase={() => addToolStep({ params: [], sql: "" }, "sqlite")}
            onDelete={deleteStep}
            onSelect={(stepId) => {
              const step = steps.find((entry) => entry.id === stepId);
              setSelectedStepId(stepId);
              setPanelTab(
                step?.kind === "tool" && step.tool === "sqlite"
                  ? "database"
                  : "configure"
              );
              setInputError(null);
            }}
            selectedStepId={selectedStepId}
            steps={steps}
          />
        </div>
        {selectedStep ? (
          <WorkflowStepPanel
            busy={busy}
            inputError={inputError}
            key={selectedStep.id}
            latestRun={runs[0] ?? null}
            onClose={() => {
              collapseDatabase();
              setSelectedStepId(null);
            }}
            onInputError={setInputError}
            onPatch={(next) => patchStep(selectedStep.id, next)}
            onRename={(nextId) => renameStep(selectedStep, nextId)}
            onTabChange={setPanelTab}
            step={selectedStep}
            stepNumber={selectedIndex + 1}
            tab={panelTab}
            tools={tools}
          />
        ) : null}
      </div>
      <WorkflowMissingToolsDialog
        assignBusy={profileSwitch.assignBusy}
        canAssign={profileSwitch.canAssign}
        onAssign={profileSwitch.assignMissing}
        onClose={profileSwitch.clear}
        toolGap={profileSwitch.toolGap}
      />
    </div>
  );
}

function insertDataStep(
  steps: WorkflowStep[],
  input: Record<string, unknown>,
  tool: string
): {
  id: string;
  steps: WorkflowStep[];
} {
  const id = `step_${crypto.randomUUID().slice(0, 8)}`;
  const next: WorkflowStep = { id, input, kind: "tool", tool };
  const summarizeAt = steps.findIndex((step) => step.kind === "summarize");
  if (summarizeAt === -1) {
    return { id, steps: [...steps, next] };
  }
  return {
    id,
    steps: [...steps.slice(0, summarizeAt), next, ...steps.slice(summarizeAt)],
  };
}

function removeWorkflowStep(
  steps: WorkflowStep[],
  stepId: string
): WorkflowStep[] | null {
  const remaining = steps.filter((step) => step.id !== stepId);
  if (remaining.filter((step) => step.kind === "summarize").length === 0) {
    return null;
  }
  return remaining;
}

async function findWorkflowToolGap({
  nextProfileId,
  onProfileChange,
  profileById,
  queryClient,
  steps,
}: {
  nextProfileId: string;
  onProfileChange: (profileId: string) => Promise<void>;
  profileById: Map<string, ProfileSummary>;
  queryClient: QueryClient;
  steps: WorkflowStep[];
}): Promise<{
  missing: string[];
  profileId: string;
  profileName: string;
} | null> {
  try {
    const detail = await queryClient.fetchQuery(
      profileQueryOptions(nextProfileId)
    );
    const missing = missingWorkflowTools(
      steps,
      new Set(detail.tools.map((entry) => entry.name))
    );
    if (missing.length === 0) {
      await onProfileChange(nextProfileId);
      return null;
    }
    return {
      missing,
      profileId: nextProfileId,
      profileName: detail.name,
    };
  } catch {
    try {
      await onProfileChange(nextProfileId);
      return null;
    } catch (error) {
      const parsed = parseUnknownWorkflowToolError(formatError(error));
      if (!parsed) {
        return null;
      }
      return {
        missing: [parsed],
        profileId: nextProfileId,
        profileName: profileById.get(nextProfileId)?.name ?? nextProfileId,
      };
    }
  }
}

function useWorkflowProfileSwitch({
  onProfileChange,
  profileById,
  steps,
  workflowProfileId,
}: {
  onProfileChange: (profileId: string) => Promise<void>;
  profileById: Map<string, ProfileSummary>;
  steps: WorkflowStep[];
  workflowProfileId: string;
}) {
  const [toolGap, setToolGap] = useState<{
    missing: string[];
    profileId: string;
    profileName: string;
  } | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: catalog = [] } = useToolsQuery();
  const assignTool = useAssignToolMutation();
  const assignableIds = (toolGap?.missing ?? [])
    .map((name) => catalog.find((entry) => entry.name === name)?.id ?? null)
    .filter((id): id is string => Boolean(id));
  const canAssign =
    user?.isPlatformAdmin === true &&
    toolGap !== null &&
    assignableIds.length === toolGap.missing.length &&
    assignableIds.length > 0;

  async function selectProfile(nextProfileId: string) {
    if (!nextProfileId || nextProfileId === workflowProfileId) {
      return;
    }
    setCheckingProfile(true);
    const gap = await findWorkflowToolGap({
      nextProfileId,
      onProfileChange,
      profileById,
      queryClient,
      steps,
    });
    if (gap) {
      setToolGap(gap);
    }
    setCheckingProfile(false);
  }

  async function assignMissing() {
    if (!(toolGap && canAssign)) {
      return;
    }
    try {
      await Promise.all(
        assignableIds.map((toolId) =>
          assignTool.mutateAsync({
            profileId: toolGap.profileId,
            toolId,
          })
        )
      );
      await onProfileChange(toolGap.profileId);
      setToolGap(null);
    } catch {}
  }

  return {
    assignBusy: assignTool.isPending,
    assignMissing,
    busy: checkingProfile || assignTool.isPending,
    canAssign,
    clear: () => setToolGap(null),
    selectProfile,
    toolGap,
  };
}

function WorkflowBuilderHeader({
  busy,
  enabled,
  name,
  onDelete,
  onRun,
}: {
  busy: boolean;
  enabled: boolean;
  name: string;
  onDelete: () => void;
  onRun: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-border border-b px-4 py-3">
      <p className="min-w-0 truncate font-medium text-sm">{name}</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          aria-label="Delete"
          className={iconHitArea}
          disabled={busy}
          onClick={onDelete}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <Delete02Icon className="size-4" strokeWidth={1.5} />
        </Button>
        <Button
          disabled={busy || !enabled}
          onClick={onRun}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlayIcon aria-hidden className="ml-0.5 size-4" strokeWidth={1.5} />
          Test run
        </Button>
      </div>
    </header>
  );
}

function WorkflowBuilderMeta({
  busy,
  description,
  enabled,
  name,
  onDescriptionChange,
  onNameChange,
  onProfileChange,
  onToggleEnabled,
  profile,
  profileDisabled,
  profileId,
  profiles,
}: {
  busy: boolean;
  description: string;
  enabled: boolean;
  name: string;
  onDescriptionChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onProfileChange: (profileId: string) => Promise<void>;
  onToggleEnabled: (enabled: boolean) => void;
  profile: ProfileSummary | undefined;
  profileDisabled: boolean;
  profileId: string;
  profiles: ProfileSummary[];
}) {
  return (
    <div className="mx-auto mb-6 max-w-xl">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Workflow name"
          className="h-8 min-w-0 flex-1 border-transparent bg-transparent font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
          onChange={(event) => onNameChange(event.target.value)}
          value={name}
        />
        <label className="flex h-10 shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            disabled={busy}
            onCheckedChange={onToggleEnabled}
          />
          Enabled
        </label>
        <Select
          disabled={busy || profileDisabled}
          onValueChange={(value) => void onProfileChange(String(value))}
          value={profileId}
        >
          <SelectTrigger
            aria-label="Profile"
            className="max-w-[11rem] shrink-0"
          >
            <SelectValue>
              <span className="truncate">{profile?.name ?? profileId}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {profiles.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        aria-label="Workflow description"
        className="mt-1 h-8 border-transparent bg-transparent text-muted-foreground shadow-none focus-visible:border-input focus-visible:bg-background"
        onChange={(event) => onDescriptionChange(event.target.value)}
        value={description}
      />
    </div>
  );
}

function WorkflowStepList({
  busy,
  onAdd,
  onAddDatabase,
  onDelete,
  onSelect,
  selectedStepId,
  steps,
}: {
  busy: boolean;
  onAdd: () => void;
  onAddDatabase: () => void;
  onDelete: (stepId: string) => void;
  onSelect: (stepId: string) => void;
  selectedStepId: string | null;
  steps: WorkflowStep[];
}) {
  return (
    <>
      <ol className="mx-auto max-w-xl">
        {steps.map((step, index) => (
          <li key={step.id}>
            <WorkflowStepCard
              index={index}
              onDelete={() => onDelete(step.id)}
              onSelect={() => onSelect(step.id)}
              selected={step.id === selectedStepId}
              step={step}
            />
            {index < steps.length - 1 ? (
              <div aria-hidden className="mx-auto h-5 w-px bg-border" />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-center gap-2">
        <Button
          disabled={busy}
          onClick={onAdd}
          size="sm"
          type="button"
          variant="outline"
        >
          <Add01Icon aria-hidden className="size-4" strokeWidth={1.5} />
          Add step
        </Button>
        <Button
          disabled={busy}
          onClick={onAddDatabase}
          size="sm"
          type="button"
          variant="outline"
        >
          <Add01Icon aria-hidden className="size-4" strokeWidth={1.5} />
          Add database
        </Button>
      </div>
    </>
  );
}

function WorkflowMissingToolsDialog({
  assignBusy,
  canAssign,
  onAssign,
  onClose,
  toolGap,
}: {
  assignBusy: boolean;
  canAssign: boolean;
  onAssign: () => Promise<void>;
  onClose: () => void;
  toolGap: {
    missing: string[];
    profileId: string;
    profileName: string;
  } | null;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={toolGap !== null}
    >
      {toolGap ? (
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>{toolGap.profileName} needs tools</DialogTitle>
            <ul className="list-disc pl-5 text-sm">
              {toolGap.missing.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </DialogHeader>
          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
            <Button
              disabled={assignBusy}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Close
            </Button>
            {canAssign ? (
              <Button
                disabled={assignBusy}
                onClick={() => void onAssign()}
                type="button"
              >
                {assignBusy ? <Spinner className="size-4" /> : "Assign"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function WorkflowStepCard({
  index,
  onDelete,
  onSelect,
  selected,
  step,
}: {
  index: number;
  onDelete: () => void;
  onSelect: () => void;
  selected: boolean;
  step: WorkflowStep;
}) {
  const meta = stepMeta(step);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl bg-card px-3 py-2 text-left",
        stepCardSurface,
        selected
          ? "shadow-md ring-foreground/20 dark:shadow-none"
          : "hover:bg-muted/30"
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3"
        onClick={onSelect}
        type="button"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs tabular-nums">
          {index + 1}
        </span>
        <span className="min-w-0 truncate font-medium text-sm">
          {meta.title}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`${meta.title} actions`}
              className={iconHitArea}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" strokeWidth={1.5} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32">
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={onDelete}
            variant="destructive"
          >
            <Delete02Icon strokeWidth={1.5} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorkflowStepPanel({
  busy,
  inputError,
  latestRun,
  onClose,
  onInputError,
  onPatch,
  onRename,
  onTabChange,
  step,
  stepNumber,
  tab,
  tools,
}: {
  busy: boolean;
  inputError: string | null;
  latestRun: WorkflowRunRecord | null;
  onClose: () => void;
  onInputError: (error: string | null) => void;
  onPatch: (step: WorkflowStep) => void;
  onRename: (id: string) => void;
  onTabChange: (tab: "configure" | "database" | "test") => void;
  step: WorkflowStep;
  stepNumber: number;
  tab: "configure" | "database" | "test";
  tools: ToolSummary[];
}) {
  const meta = stepMeta(step);
  const receipt = latestRun?.steps?.find((entry) => entry.stepId === step.id);
  const [inputDraft, setInputDraft] = useState(() =>
    step.kind === "tool" ? JSON.stringify(step.input, null, 2) : ""
  );
  const isSqlite = step.kind === "tool" && step.tool === "sqlite";
  const expanded = useWorkflowDatabaseUi((state) => state.expanded);
  const expand = useWorkflowDatabaseUi((state) => state.expand);
  const collapse = useWorkflowDatabaseUi((state) => state.collapse);
  const host = useWorkflowStepHost();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (expanded) {
        collapse();
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapse, expanded, onClose]);

  const drawer = (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex min-h-0 flex-col border-border border-l bg-background shadow-xl",
        "slide-in-from-right animate-in duration-200",
        expanded
          ? "inset-0 w-full"
          : isSqlite
            ? "w-[min(36rem,100%)]"
            : "w-[min(22rem,100%)]"
      )}
    >
      <div className="flex items-center gap-3 border-border border-b px-4 py-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs tabular-nums">
          {stepNumber}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{meta.title}</div>
          <div className="text-muted-foreground text-xs">{meta.kindLabel}</div>
        </div>
        <Button
          aria-label={expanded ? "Collapse step" : "Expand step"}
          className={iconHitArea}
          onClick={expanded ? collapse : expand}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {expanded ? (
            <ArrowShrink02Icon className="size-4" strokeWidth={1.5} />
          ) : (
            <ArrowExpand01Icon className="size-4" strokeWidth={1.5} />
          )}
        </Button>
        <Button
          aria-label="Close step"
          className={iconHitArea}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Cancel01Icon className="size-4" strokeWidth={1.5} />
        </Button>
      </div>

      <div className="flex gap-4 border-border border-b px-4">
        <PanelTab
          active={tab === "configure"}
          onClick={() => onTabChange("configure")}
        >
          Configure
        </PanelTab>
        {isSqlite ? (
          <PanelTab
            active={tab === "database"}
            onClick={() => onTabChange("database")}
          >
            Database
          </PanelTab>
        ) : null}
        <PanelTab active={tab === "test"} onClick={() => onTabChange("test")}>
          Test
        </PanelTab>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 p-4",
          expanded && tab === "database" ? "overflow-hidden" : "overflow-y-auto"
        )}
      >
        {tab === "configure" ? (
          <div className={cn("space-y-4", expanded && "mx-auto max-w-xl")}>
            <FormField id={`step-${step.id}-name`} label="Name">
              <Input
                disabled={busy}
                id={`step-${step.id}-name`}
                onChange={(event) => onRename(event.target.value)}
                value={step.id}
              />
            </FormField>
            <StepConfigureFields
              busy={busy}
              inputDraft={inputDraft}
              inputError={inputError}
              onInputDraft={setInputDraft}
              onInputError={onInputError}
              onPatch={onPatch}
              step={step}
              tools={tools}
            />
          </div>
        ) : tab === "database" && isSqlite ? (
          <WorkflowDatabaseExplorer layout={expanded ? "split" : "stack"} />
        ) : (
          <div className={cn(expanded && "mx-auto max-w-xl")}>
            <StepTestReceipt latestRun={latestRun} receipt={receipt} />
          </div>
        )}
      </div>
    </aside>
  );

  if (!host) {
    return null;
  }

  return createPortal(
    <>
      <button
        aria-label="Close step"
        className="fade-in-0 absolute inset-0 z-20 animate-in bg-background/50 duration-200"
        onClick={onClose}
        type="button"
      />
      {drawer}
    </>,
    host
  );
}

function useWorkflowStepHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHost(document.getElementById("agent-work-panel-workflows"));
  }, []);

  return host;
}

function StepConfigureFields({
  busy,
  inputDraft,
  inputError,
  onInputDraft,
  onInputError,
  onPatch,
  step,
  tools,
}: {
  busy: boolean;
  inputDraft: string;
  inputError: string | null;
  onInputDraft: (value: string) => void;
  onInputError: (error: string | null) => void;
  onPatch: (step: WorkflowStep) => void;
  step: WorkflowStep;
  tools: ToolSummary[];
}) {
  if (step.kind === "tool") {
    const toolNames = uniqueToolNames(tools, step.tool);
    const sql = typeof step.input.sql === "string" ? step.input.sql : "";
    return (
      <>
        <FormField id={`step-${step.id}-tool`} label="Tool">
          <Select
            disabled={busy}
            onValueChange={(value) => onPatch({ ...step, tool: String(value) })}
            value={step.tool}
          >
            <SelectTrigger className="w-full" id={`step-${step.id}-tool`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {toolNames.map((tool) => (
                <SelectItem key={tool} value={tool}>
                  {toolLabel(tool)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {step.tool === "sqlite" ? (
          <FormField id={`step-${step.id}-sql`} label="SQL">
            <Textarea
              className="min-h-40 font-mono text-xs"
              disabled={busy}
              id={`step-${step.id}-sql`}
              onChange={(event) =>
                onPatch({
                  ...step,
                  input: { ...step.input, sql: event.target.value },
                })
              }
              spellCheck={false}
              value={sql}
            />
          </FormField>
        ) : (
          <FormField
            footer={
              inputError ? (
                <p className="text-destructive text-xs">{inputError}</p>
              ) : null
            }
            id={`step-${step.id}-input`}
            label="Input"
          >
            <Textarea
              className="min-h-40 font-mono text-xs"
              disabled={busy}
              id={`step-${step.id}-input`}
              onChange={(event) => {
                const text = event.target.value;
                onInputDraft(text);
                try {
                  const parsed = JSON.parse(text) as unknown;
                  if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                  ) {
                    onInputError("Input must be a JSON object.");
                    return;
                  }
                  onInputError(null);
                  onPatch({
                    ...step,
                    input: parsed as Record<string, unknown>,
                  });
                } catch {
                  onInputError("Invalid JSON.");
                }
              }}
              spellCheck={false}
              value={inputDraft}
            />
          </FormField>
        )}
      </>
    );
  }

  if (step.kind === "summarize") {
    return (
      <FormField id={`step-${step.id}-prompt`} label="Prompt">
        <Textarea
          className="min-h-32"
          disabled={busy}
          id={`step-${step.id}-prompt`}
          onChange={(event) => onPatch({ ...step, prompt: event.target.value })}
          value={step.prompt}
        />
      </FormField>
    );
  }

  if (step.kind === "compare") {
    return (
      <>
        <FormField id={`step-${step.id}-op`} label="Op">
          <Select
            disabled={busy}
            onValueChange={(value) =>
              onPatch({
                ...step,
                op: value as "eq" | "near" | "contains",
              })
            }
            value={step.op}
          >
            <SelectTrigger className="w-full" id={`step-${step.id}-op`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="eq">eq</SelectItem>
              <SelectItem value="near">near</SelectItem>
              <SelectItem value="contains">contains</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id={`step-${step.id}-left`} label="Left">
          <Input
            disabled={busy}
            id={`step-${step.id}-left`}
            onChange={(event) => onPatch({ ...step, left: event.target.value })}
            value={stringifyValue(step.left)}
          />
        </FormField>
        <FormField id={`step-${step.id}-right`} label="Right">
          <Input
            disabled={busy}
            id={`step-${step.id}-right`}
            onChange={(event) =>
              onPatch({ ...step, right: event.target.value })
            }
            value={stringifyValue(step.right)}
          />
        </FormField>
      </>
    );
  }

  if (step.kind === "assert") {
    return (
      <>
        <FormField id={`step-${step.id}-path`} label="Path">
          <Input
            disabled={busy}
            id={`step-${step.id}-path`}
            onChange={(event) => onPatch({ ...step, path: event.target.value })}
            value={step.path}
          />
        </FormField>
        <FormField id={`step-${step.id}-expected`} label="Expected">
          <Input
            disabled={busy}
            id={`step-${step.id}-expected`}
            onChange={(event) =>
              onPatch({ ...step, expected: event.target.value })
            }
            value={stringifyValue(step.expected)}
          />
        </FormField>
      </>
    );
  }

  return (
    <FormField id={`step-${step.id}-template`} label="Template">
      <Textarea
        className="min-h-24 font-mono text-xs"
        disabled={busy}
        id={`step-${step.id}-template`}
        onChange={(event) => onPatch({ ...step, template: event.target.value })}
        value={step.template}
      />
    </FormField>
  );
}

function StepTestReceipt({
  latestRun,
  receipt,
}: {
  latestRun: WorkflowRunRecord | null;
  receipt: WorkflowRunStepRecord | undefined;
}) {
  if (!latestRun) {
    return <p className="text-muted-foreground text-sm">No runs yet.</p>;
  }

  const sqlitePreview = asSqlitePreview(receipt?.output);

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="font-medium capitalize">{latestRun.status}</div>
        {latestRun.error ? (
          <p className="mt-1 text-destructive">{latestRun.error}</p>
        ) : null}
      </div>
      {receipt ? (
        <div className="rounded-lg border border-border p-3">
          <div className="font-medium text-xs">
            {receipt.stepId} · {receipt.status}
          </div>
          {receipt.error ? (
            <p className="mt-2 text-destructive">{receipt.error}</p>
          ) : null}
          {receipt.output == null ? null : sqlitePreview ? (
            <div className="mt-2">
              <SqliteRowsTable preview={sqlitePreview} />
            </div>
          ) : (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(receipt.output, null, 2)}
            </pre>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">No receipt for this step.</p>
      )}
    </div>
  );
}

function WorkflowDatabaseExplorer({ layout }: { layout: "split" | "stack" }) {
  const table = useWorkflowDatabaseUi((state) => state.table);
  const setTable = useWorkflowDatabaseUi((state) => state.setTable);
  const queueSql = useWorkflowDatabaseUi((state) => state.queueSql);
  const inspect = useWorkflowSqliteQuery(table, true);
  const tables = inspect.data?.tables ?? [];
  const firstTable = inspect.data?.tables[0]?.name;

  useEffect(() => {
    if (table || !firstTable) {
      return;
    }
    setTable(firstTable);
  }, [firstTable, setTable, table]);

  if (inspect.isLoading && !inspect.data) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (inspect.error) {
    return (
      <p className="text-destructive text-sm">{formatError(inspect.error)}</p>
    );
  }

  if (tables.length === 0) {
    return <p className="text-muted-foreground text-sm">No tables yet.</p>;
  }

  const preview = inspect.data?.preview ?? null;
  const tableList = (
    <ul className="flex flex-col gap-1">
      {tables.map((entry) => (
        <li key={entry.name}>
          <button
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
              entry.name === table ? "bg-muted" : "hover:bg-muted/50"
            )}
            onClick={() => setTable(entry.name)}
            type="button"
          >
            <span className="min-w-0 truncate font-medium">{entry.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              {entry.rowCount}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={cn(
        "flex min-h-0",
        layout === "split" ? "h-full gap-4" : "flex-col gap-3"
      )}
    >
      <div
        className={cn(
          layout === "split"
            ? "flex w-56 shrink-0 flex-col gap-3 overflow-y-auto"
            : "flex flex-col gap-3"
        )}
      >
        {tableList}
        {table ? (
          <Button
            onClick={() => queueSql(`SELECT * FROM ${table} LIMIT 50`)}
            size="sm"
            type="button"
            variant="outline"
          >
            Query {table}
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0",
          layout === "split" && "flex-1 overflow-auto"
        )}
      >
        {preview ? <SqliteRowsTable preview={preview} wide /> : null}
      </div>
    </div>
  );
}

function SqliteRowsTable({
  preview,
  wide = false,
}: {
  preview: WorkflowSqlitePreview;
  wide?: boolean;
}) {
  if (preview.columns.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{preview.total} rows</p>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-md border border-border">
      <table className="w-full min-w-max text-left text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            {preview.columns.map((column) => (
              <th className="px-2 py-1.5 font-medium" key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr
              className="border-border border-t"
              key={preview.columns
                .map((column) => stringifyCell(row[column]))
                .join("\u0001")}
            >
              {preview.columns.map((column) => (
                <td
                  className={cn(
                    "px-2 py-1.5 tabular-nums",
                    wide ? "max-w-80 truncate" : "max-w-48 truncate"
                  )}
                  key={column}
                >
                  {stringifyCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function asSqlitePreview(output: unknown): WorkflowSqlitePreview | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const record = output as {
    columns?: unknown;
    rows?: unknown;
    table?: unknown;
    total?: unknown;
  };
  if (!(Array.isArray(record.columns) && Array.isArray(record.rows))) {
    return null;
  }
  const columns = record.columns.map((column) => String(column));
  const rows = record.rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
  return {
    columns,
    rows,
    table: typeof record.table === "string" ? record.table : "",
    total: typeof record.total === "number" ? record.total : rows.length,
  };
}

function stringifyCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function PanelTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "min-h-10 border-b-2 py-2 text-sm transition-[color,border-color] duration-150 ease-out",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function stepMeta(step: WorkflowStep): {
  kindLabel: string;
  title: string;
} {
  const title = humanizeId(step.id);
  if (step.kind === "tool") {
    return { kindLabel: toolLabel(step.tool), title };
  }
  if (step.kind === "compare") {
    return { kindLabel: "Compare", title };
  }
  if (step.kind === "assert") {
    return { kindLabel: "Assert", title };
  }
  if (step.kind === "template") {
    return { kindLabel: "Template", title };
  }
  return { kindLabel: "Summarize", title };
}

function humanizeId(id: string): string {
  return id
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

function toolLabel(tool: string): string {
  if (tool === "web_fetch") {
    return "Web Fetch";
  }
  if (tool === "web_search") {
    return "Web Search";
  }
  if (tool === "sqlite") {
    return "SQLite";
  }
  return tool;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return JSON.stringify(value);
}

function uniqueToolNames(tools: ToolSummary[], current: string): string[] {
  const names = new Set(tools.map((tool) => tool.name));
  names.add(current);
  names.delete("web_search");
  return [...names].sort((left, right) => left.localeCompare(right));
}
