import type {
  ProfileSummary,
  StoredWorkflow,
  ToolSummary,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowStep,
} from "@nakama/core/contract";
import {
  missingWorkflowTools,
  parseUnknownWorkflowToolError,
} from "@nakama/core/workflow-ops";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  Add01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Delete02Icon,
  File01Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PlayIcon,
  Search01Icon,
} from "hugeicons-react";
import { useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
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
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

const iconHitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

const stepCardSurface =
  "shadow-sm ring-1 ring-border/80 transition-[box-shadow,background-color] duration-150 ease-out dark:shadow-none";

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
  const [panelTab, setPanelTab] = useState<"configure" | "test">("configure");
  const [inputError, setInputError] = useState<string | null>(null);
  const { data: profile } = useProfileQuery(workflow.profileId);
  const tools = profile?.tools ?? [];
  const profileSwitch = useWorkflowProfileSwitch({
    onProfileChange,
    profileById,
    steps,
    workflowProfileId: workflow.profileId,
  });

  const dirty =
    name !== workflow.name ||
    description !== workflow.description ||
    JSON.stringify(steps) !== JSON.stringify(workflow.steps);

  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? null;
  const selectedIndex = selectedStep
    ? steps.findIndex((step) => step.id === selectedStep.id)
    : -1;

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

  function addStep() {
    const inserted = insertToolStep(steps);
    setSteps(inserted.steps);
    setSelectedStepId(inserted.id);
    setPanelTab("configure");
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
        dirty={dirty}
        enabled={workflow.enabled}
        name={name}
        onDelete={onDelete}
        onRun={onRun}
        onSave={() => void onSave({ description, name, steps })}
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
            onAdd={addStep}
            onDelete={deleteStep}
            onSelect={(stepId) => {
              setSelectedStepId(stepId);
              setPanelTab("configure");
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
            onClose={() => setSelectedStepId(null)}
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

function insertToolStep(steps: WorkflowStep[]): {
  id: string;
  steps: WorkflowStep[];
} {
  const id = `step_${crypto.randomUUID().slice(0, 8)}`;
  const next: WorkflowStep = {
    id,
    input: { url: "" },
    kind: "tool",
    tool: "web_fetch",
  };
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
  dirty,
  enabled,
  name,
  onDelete,
  onRun,
  onSave,
}: {
  busy: boolean;
  dirty: boolean;
  enabled: boolean;
  name: string;
  onDelete: () => void;
  onRun: () => void;
  onSave: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-border border-b px-4 py-3">
      <p className="min-w-0 truncate text-muted-foreground text-sm">
        Workflows
        <span className="px-1.5">/</span>
        <span className="text-foreground">{name}</span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Workflow actions"
                className={iconHitArea}
                size="icon-sm"
                type="button"
                variant="outline"
              />
            }
          >
            <MoreHorizontalIcon className="size-4" strokeWidth={1.5} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={busy}
              onClick={onDelete}
              variant="destructive"
            >
              <Delete02Icon strokeWidth={1.5} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <Button
          disabled={busy || !dirty}
          onClick={onSave}
          size="sm"
          type="button"
        >
          Save
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
          className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
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
              <span className="flex min-w-0 items-center gap-2">
                {profile ? <ProfileAvatar profile={profile} size="sm" /> : null}
                <span className="truncate">{profile?.name ?? profileId}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {profiles.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                <span className="flex items-center gap-2">
                  <ProfileAvatar profile={entry} size="sm" />
                  <span>{entry.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        aria-label="Workflow description"
        className="mt-1 h-8 border-transparent bg-transparent px-0 text-muted-foreground shadow-none focus-visible:border-input focus-visible:bg-background"
        onChange={(event) => onDescriptionChange(event.target.value)}
        value={description}
      />
    </div>
  );
}

function WorkflowStepList({
  busy,
  onAdd,
  onDelete,
  onSelect,
  selectedStepId,
  steps,
}: {
  busy: boolean;
  onAdd: () => void;
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
      <div className="mt-4 flex justify-center">
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
  onTabChange: (tab: "configure" | "test") => void;
  step: WorkflowStep;
  stepNumber: number;
  tab: "configure" | "test";
  tools: ToolSummary[];
}) {
  const meta = stepMeta(step);
  const receipt = latestRun?.steps?.find((entry) => entry.stepId === step.id);
  const [inputDraft, setInputDraft] = useState(() =>
    step.kind === "tool" ? JSON.stringify(step.input, null, 2) : ""
  );

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex min-h-0 w-[min(22rem,calc(100%-1.5rem))] flex-col bg-background shadow-lg ring-1 ring-border/80 dark:shadow-none">
      <div className="flex items-start gap-3 border-border border-b px-4 py-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs tabular-nums">
          {stepNumber}
        </span>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            meta.iconClass
          )}
        >
          <meta.icon aria-hidden className="size-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{meta.title}</div>
          <div className="text-muted-foreground text-xs">{meta.kindLabel}</div>
        </div>
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
        <PanelTab active={tab === "test"} onClick={() => onTabChange("test")}>
          Test
        </PanelTab>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "configure" ? (
          <div className="space-y-4">
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
        ) : (
          <StepTestReceipt latestRun={latestRun} receipt={receipt} />
        )}
      </div>
    </aside>
  );
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
          {receipt.output == null ? null : (
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
  icon: typeof Link01Icon;
  iconClass: string;
  kindLabel: string;
  title: string;
} {
  const title = humanizeId(step.id);
  if (step.kind === "tool") {
    return {
      icon: step.tool === "web_fetch" ? Link01Icon : Search01Icon,
      iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      kindLabel: toolLabel(step.tool),
      title,
    };
  }
  if (step.kind === "compare") {
    return {
      icon: Search01Icon,
      iconClass: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
      kindLabel: "Compare",
      title,
    };
  }
  if (step.kind === "assert") {
    return {
      icon: CheckmarkCircle01Icon,
      iconClass: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      kindLabel: "Assert",
      title,
    };
  }
  if (step.kind === "template") {
    return {
      icon: File01Icon,
      iconClass: "bg-muted text-muted-foreground",
      kindLabel: "Template",
      title,
    };
  }
  return {
    icon: File01Icon,
    iconClass: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    kindLabel: "Summarize",
    title,
  };
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
