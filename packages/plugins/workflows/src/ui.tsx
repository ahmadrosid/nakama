/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type {
  StoredWorkflow,
  WorkflowRunRecord,
  WorkflowStep,
} from "@nakama/core/contract";
import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
import css from "../ui/style.css" with { type: "text" };

type Profile = { id: string; name: string; isDefault?: boolean };
type StepDraft = {
  key: string;
  id: string;
  kind: string;
  fields: Record<string, string>;
};
type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  signal: AbortSignal;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
};
export const inject = ["slots", "host", "styles", "ui"];
const stepFields: Record<string, string[]> = {
  assert: ["path", "expected"],
  compare: ["left", "op", "right", "tolerance"],
  template: ["template"],
  tool: ["tool", "input"],
};
function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function draftStep(step: WorkflowStep): StepDraft {
  return {
    fields: Object.fromEntries(
      Object.entries(step)
        .filter(([key]) => key !== "id" && key !== "kind")
        .map(([key, value]) => [
          key,
          typeof value === "string" &&
          !["left", "right", "expected", "tolerance"].includes(key)
            ? value
            : JSON.stringify(value, null, 2),
        ])
    ),
    id: step.id,
    key: crypto.randomUUID(),
    kind: step.kind,
  };
}
function serializeSteps(steps: StepDraft[]) {
  return steps.map(({ id, kind, fields }) => ({
    id,
    kind,
    ...Object.fromEntries(
      (stepFields[kind] ?? [])
        .filter((key) => key !== "tolerance" || fields[key])
        .map((key) => [
          key,
          key === "input"
            ? JSON.parse(fields[key] || "{}")
            : ["left", "right", "expected", "tolerance"].includes(key)
              ? parseValue(fields[key] ?? "")
              : (fields[key] ?? ""),
        ])
    ),
  }));
}

export function apply(ctx: Context) {
  const React = ctx.React;
  const {
    Button,
    Input,
    Textarea,
    Switch,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  } = ctx.ui;

  function Choice({
    label,
    value,
    options,
    onChange,
    disabled = false,
  }: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange(value: string): void;
    disabled?: boolean;
  }) {
    return (
      <Select
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) {
            onChange(String(next));
          }
        }}
        value={value}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {options.find((option) => option.value === value)?.label ?? label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  function Icon({
    kind,
  }: {
    kind:
      | "add"
      | "play"
      | "delete"
      | "more"
      | "expand"
      | "close"
      | "collapse"
      | "workflow";
  }) {
    const paths = {
      add: "M12 5v14M5 12h14",
      close: "m6 6 12 12M6 18 18 6",
      collapse: "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7",
      delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7",
      expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
      more: "M5 12h.01M12 12h.01M19 12h.01",
      play: "m8 5 11 7-11 7V5Z",
      workflow: "M4 3h6v6H4V3ZM14 15h6v6h-6v-6ZM7 9v9h7M10 6h7v9",
    };
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={kind === "more" ? 3 : 1.5}
        viewBox="0 0 24 24"
        width="16"
      >
        <path d={paths[kind]} />
      </svg>
    );
  }
  ctx.styles(css);
  const action = async <T,>(name: string, input?: unknown): Promise<T> =>
    (await ctx.host.call(name, input)) as T;

  function WorkflowsPage() {
    const [data, setData] = React.useState<{
      workflows: StoredWorkflow[];
      profiles: Profile[];
    } | null>(null);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      let active = true;
      Promise.all([
        action<StoredWorkflow[]>("list_workflows"),
        action<Profile[]>("profiles"),
      ])
        .then(([workflows, profiles]) => {
          if (active) {
            setData({ profiles, workflows });
            setSelectedId(workflows[0]?.id ?? null);
          }
        })
        .catch((error) => {
          if (active) {
            setError(String(error.message ?? error));
          }
        });
      return () => {
        active = false;
      };
    }, []);
    const saved = async (id?: string) => {
      const workflows = await action<StoredWorkflow[]>("list_workflows");
      setData((current) => current && { ...current, workflows });
      setSelectedId((current) =>
        current === selectedId ? (id ?? workflows[0]?.id ?? null) : current
      );
    };
    const selected =
      data?.workflows.find((workflow) => workflow.id === selectedId) ?? null;
    return (
      <main className="workflows-page">
        {error && <p role="alert">{error}</p>}
        {data ? (
          <div
            className="workflow-layout"
            data-empty={data.workflows.length === 0}
          >
            {data.workflows.length > 0 && (
              <aside aria-label="Workflows" className="workflow-sidebar">
                <ul>
                  {data.workflows.map((workflow) => (
                    <li key={workflow.id}>
                      <Button
                        aria-current={
                          selectedId === workflow.id ? "true" : undefined
                        }
                        className="workflow-list-item"
                        onClick={() => setSelectedId(workflow.id)}
                        type="button"
                        variant="ghost"
                      >
                        <span className="workflow-list-name">
                          {workflow.name}
                        </span>
                        <span className="workflow-list-meta">
                          {workflow.steps.length} steps ·{" "}
                          {data.profiles.find(
                            (profile) => profile.id === workflow.profileId
                          )?.name ?? workflow.profileId}
                        </span>
                        <span className="workflow-list-state">
                          <span
                            className="workflow-status-dot"
                            data-enabled={workflow.enabled}
                          />
                          {workflow.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  className="workflow-create"
                  onClick={() => setSelectedId("")}
                  type="button"
                  variant="ghost"
                >
                  <Icon kind="add" />
                  New workflow
                </Button>
              </aside>
            )}
            {selected || selectedId === "" ? (
              <Editor
                key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`}
                onSaved={saved}
                profiles={data.profiles}
                workflow={selected}
              />
            ) : (
              <section className="workflow-welcome">
                <div className="workflow-welcome-icon">
                  <Icon kind="workflow" />
                </div>
                <h2>
                  {data.workflows.length
                    ? "Select a workflow"
                    : "Create your first workflow"}
                </h2>
                <Button onClick={() => setSelectedId("")} type="button">
                  <Icon kind="add" />
                  Create workflow
                </Button>
              </section>
            )}
          </div>
        ) : (
          <p role="status">{error ? "Unavailable" : "Loading…"}</p>
        )}
      </main>
    );
  }

  function Editor({
    workflow,
    profiles,
    onSaved,
  }: {
    workflow: StoredWorkflow | null;
    profiles: Profile[];
    onSaved(id?: string): Promise<void>;
  }) {
    const [name, setName] = React.useState(workflow?.name ?? "");
    const [description, setDescription] = React.useState(
      workflow?.description ?? ""
    );
    const [agentId, setAgentId] = React.useState(
      workflow?.profileId ??
        profiles.find((p) => p.isDefault)?.id ??
        profiles[0]?.id ??
        ""
    );
    const [enabled, setEnabled] = React.useState(workflow?.enabled ?? true);
    const summaryStep = workflow?.steps.find(
      (step) => step.kind === "summarize"
    );
    const [summary, setSummary] = React.useState(
      summaryStep?.prompt ?? "Summarize only the step results."
    );
    const [steps, setSteps] = React.useState<StepDraft[]>(() =>
      (workflow?.steps.filter((step) => step.kind !== "summarize") ?? []).map(
        draftStep
      )
    );
    const [runInput, setRunInput] = React.useState("{}");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [runs, setRuns] = React.useState<WorkflowRunRecord[]>([]);
    const [confirmDelete, setConfirmDelete] = React.useState(false);
    const [selection, setSelection] = React.useState("");
    const [panelTab, setPanelTab] = React.useState("configure");
    const [expanded, setExpanded] = React.useState(false);
    const [tools, setTools] = React.useState<Array<{ name: string }>>([]);
    const [toolsError, setToolsError] = React.useState("");
    const panelRef = React.useRef<HTMLElement>(null);
    React.useEffect(() => {
      let active = true;
      setTools([]);
      setToolsError("");
      action<Array<{ name: string }>>("tools", { agentId })
        .then((result) => {
          if (active) {
            setTools(result);
          }
        })
        .catch((error) => {
          if (active) {
            setToolsError(String(error.message ?? error));
          }
        });
      return () => {
        active = false;
      };
    }, [agentId]);
    React.useEffect(() => {
      setPanelTab("configure");
      setExpanded(false);
      if (!selection) {
        return;
      }
      const previous = document.activeElement;
      panelRef.current?.focus();
      return () => {
        if (previous instanceof HTMLElement && previous.isConnected) {
          previous.focus();
        }
      };
    }, [selection]);
    React.useEffect(() => {
      if (!selection) {
        return;
      }
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.defaultPrevented) {
          return;
        }
        if (expanded) {
          setExpanded(false);
        } else {
          setSelection("");
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [selection, expanded]);
    const selectedIndex = steps.findIndex((step) => step.key === selection);
    const selectedStep = steps[selectedIndex];
    const initialDraft = React.useRef(
      JSON.stringify({ agentId, description, enabled, name, steps, summary })
    );
    const dirty =
      initialDraft.current !==
      JSON.stringify({ agentId, description, enabled, name, steps, summary });
    const mounted = React.useRef(true);
    const inFlight = React.useRef(false);
    React.useEffect(() => {
      mounted.current = true;
      if (workflow) {
        action<WorkflowRunRecord[]>("runs", { workflowId: workflow.id })
          .then((result) => {
            if (mounted.current) {
              setRuns(result);
            }
          })
          .catch((error) => {
            if (mounted.current) {
              setError(String(error.message ?? error));
            }
          });
      }
      return () => {
        mounted.current = false;
      };
    }, [workflow]);
    const perform = async (work: () => Promise<void>) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        await work();
      } catch (error) {
        if (mounted.current) {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setBusy(false);
        }
      }
    };
    const save = (event: ReactType.FormEvent) => {
      event.preventDefault();
      void perform(async () => {
        if (!(name.trim() && agentId && summary.trim())) {
          setSelection(summary.trim() ? "" : "summary");
          throw new Error(
            "Enter a workflow name, choose an agent, and add summary instructions."
          );
        }
        const result = await action<StoredWorkflow>(
          workflow ? "update_workflow" : "create_workflow",
          {
            agentId,
            description,
            enabled,
            name,
            steps: [
              ...serializeSteps(steps),
              {
                id: summaryStep?.id ?? "summary",
                kind: "summarize",
                prompt: summary,
              },
            ],
            workflowId: workflow?.id,
          }
        );
        if (mounted.current) {
          await onSaved(result.id);
        }
      });
    };
    const updateStep = (key: string, update: Partial<StepDraft>) =>
      setSteps((current) =>
        current.map((step) =>
          step.key === key ? { ...step, ...update } : step
        )
      );
    const moveStep = (key: string, delta: number) =>
      setSteps((current) => {
        const next = [...current];
        const index = next.findIndex((step) => step.key === key);
        const target = index + delta;
        if (target >= 0 && target < next.length) {
          [next[index], next[target]] = [next[target]!, next[index]!];
        }
        return next;
      });
    const addStep = (database = false) => {
      const step: StepDraft = {
        fields: database
          ? { input: '{"sql":"","params":[]}', tool: "sqlite" }
          : { input: '{"url":""}', tool: "web_fetch" },
        id: `step_${crypto.randomUUID().slice(0, 8)}`,
        key: crypto.randomUUID(),
        kind: "tool",
      };
      setSteps((current) => [...current, step]);
      setSelection(step.key);
    };
    const runWorkflow = () =>
      void perform(async () => {
        if (!workflow || dirty || !enabled) {
          return;
        }
        const input: unknown = JSON.parse(runInput || "{}");
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error("Run input must be a JSON object.");
        }
        const result = await action<{ error?: string }>("run_workflow", {
          input,
          workflowId: workflow.id,
        });
        const history = await action<WorkflowRunRecord[]>("runs", {
          workflowId: workflow.id,
        });
        if (mounted.current) {
          setRuns(history);
        }
        if (result.error) {
          throw new Error(result.error);
        }
      });
    const title = (id: string) =>
      id
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
    return (
      <section className="workflow-editor">
        <form onSubmit={save}>
          <fieldset className="editor-fields" disabled={busy}>
            <header className="editor-toolbar">
              <p>{name || "New workflow"}</p>
              <div className="workflow-actions">
                {(dirty || !workflow) && (
                  <Button disabled={busy} size="sm" type="submit">
                    {busy ? "Saving…" : "Save"}
                  </Button>
                )}
                <Button
                  aria-label="Delete workflow"
                  disabled={busy || !workflow}
                  onClick={() => setConfirmDelete(true)}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Icon kind="delete" />
                </Button>
                <Button
                  disabled={busy || !workflow || dirty || !enabled}
                  onClick={runWorkflow}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icon kind="play" />
                  {busy ? "Running…" : "Test run"}
                </Button>
              </div>
            </header>
            <div className="workflow-scroll">
              <div className="workflow-content">
                {error && (
                  <p className="workflow-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="workflow-meta">
                  <div className="workflow-meta-row">
                    <Input
                      aria-label="Workflow name"
                      className="workflow-name"
                      maxLength={200}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Untitled workflow"
                      required
                      value={name}
                    />
                    <label className="workflow-enabled">
                      <Switch
                        aria-label="Enabled"
                        checked={enabled}
                        disabled={busy}
                        onCheckedChange={setEnabled}
                      />
                      Enabled
                    </label>
                    <Choice
                      disabled={busy}
                      label="Agent"
                      onChange={setAgentId}
                      options={profiles.map((profile) => ({
                        label: profile.name,
                        value: profile.id,
                      }))}
                      value={agentId}
                    />
                  </div>
                  <Input
                    aria-label="Workflow description"
                    className="workflow-description"
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Description"
                    value={description}
                  />
                </div>
                <ol className="workflow-steps">
                  {[
                    ...steps.map((step) => ({ id: step.id, key: step.key })),
                    { id: summaryStep?.id ?? "summary", key: "summary" },
                  ].map((step, index) => (
                    <li key={step.key}>
                      <div
                        className="workflow-step-card"
                        data-selected={selection === step.key}
                      >
                        <Button
                          className="workflow-step-open"
                          onClick={() => setSelection(step.key)}
                          type="button"
                          variant="ghost"
                        >
                          <span className="workflow-step-number">
                            {index + 1}
                          </span>
                          <span>{title(step.id) || "Untitled step"}</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={busy}
                            render={
                              <Button
                                aria-label={`Options for ${title(step.id)}`}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              />
                            }
                          >
                            <Icon kind="more" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setSelection(step.key)}
                            >
                              Configure
                            </DropdownMenuItem>
                            {step.key !== "summary" && (
                              <>
                                <DropdownMenuItem
                                  disabled={index === 0}
                                  onClick={() => moveStep(step.key, -1)}
                                >
                                  Move earlier
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={index === steps.length - 1}
                                  onClick={() => moveStep(step.key, 1)}
                                >
                                  Move later
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setSteps((current) =>
                                      current.filter(
                                        (entry) => entry.key !== step.key
                                      )
                                    )
                                  }
                                  variant="destructive"
                                >
                                  Delete step
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {index < steps.length && (
                        <div
                          aria-hidden="true"
                          className="workflow-connector"
                        />
                      )}
                    </li>
                  ))}
                </ol>
                <div className="workflow-add-actions">
                  <Button
                    onClick={() => addStep()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Icon kind="add" />
                    Add step
                  </Button>
                  <Button
                    onClick={() => addStep(true)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Icon kind="add" />
                    Add database
                  </Button>
                </div>
                <section aria-label="Run history" className="workflow-runs">
                  <div className="workflow-runs-header">
                    <h2>Runs</h2>
                    <Button
                      onClick={() => setSelection("input")}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Run input
                    </Button>
                  </div>
                  {!runs.length && (
                    <p className="workflow-empty">No runs yet.</p>
                  )}
                  {runs.map((run) => (
                    <details className="workflow-run-record" key={run.id}>
                      <summary>
                        <span data-status={run.status}>{run.status}</span>
                        <time dateTime={run.startedAt}>
                          {new Date(run.startedAt).toLocaleString()}
                        </time>
                      </summary>
                      {(run.error || run.output) && (
                        <pre>{run.error || run.output}</pre>
                      )}
                      {(run.steps ?? []).map((step) => (
                        <div key={step.id}>
                          <h3>
                            {step.stepId} · {step.status}
                          </h3>
                          <pre>
                            {JSON.stringify(
                              {
                                error: step.error,
                                input: step.input,
                                output: step.output,
                              },
                              null,
                              2
                            )}
                          </pre>
                        </div>
                      ))}
                    </details>
                  ))}
                </section>
                <Button
                  onClick={() => setSelection("data")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Workflow data
                </Button>
              </div>
            </div>
          </fieldset>
        </form>
        {(selectedStep || selection === "summary" || selection === "data") && (
          <aside
            aria-label={
              selection === "data" ? "Workflow data" : "Workflow step"
            }
            className="workflow-step-drawer"
            data-expanded={expanded}
            ref={panelRef}
            tabIndex={-1}
          >
            <header className="workflow-drawer-header">
              {selection !== "data" && (
                <span className="workflow-step-number">
                  {selectedStep ? selectedIndex + 1 : steps.length + 1}
                </span>
              )}
              <div className="workflow-drawer-title">
                <h2>
                  {selection === "data"
                    ? "Workflow data"
                    : title(selectedStep?.id ?? summaryStep?.id ?? "summary")}
                </h2>
                {selection !== "data" && (
                  <p>
                    {selectedStep
                      ? title(selectedStep.fields.tool ?? selectedStep.kind)
                      : "Summarize"}
                  </p>
                )}
              </div>
              <Button
                aria-label={
                  selection === "data"
                    ? expanded
                      ? "Collapse data"
                      : "Expand data"
                    : expanded
                      ? "Collapse step"
                      : "Expand step"
                }
                onClick={() => setExpanded((value) => !value)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icon kind={expanded ? "collapse" : "expand"} />
              </Button>
              <Button
                aria-label={selection === "data" ? "Close data" : "Close step"}
                onClick={() => setSelection("")}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icon kind="close" />
              </Button>
            </header>
            {selection !== "data" && (
              <div aria-label="Step views" className="workflow-drawer-tabs">
                {[
                  "configure",
                  ...(selectedStep?.fields.tool === "sqlite"
                    ? ["database"]
                    : []),
                  "test",
                ].map((tab) => (
                  <Button
                    aria-pressed={panelTab === tab}
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    type="button"
                    variant="ghost"
                  >
                    {title(tab)}
                  </Button>
                ))}
              </div>
            )}
            <div className="workflow-drawer-body">
              {selection !== "data" && panelTab === "configure" && (
                <div className="workflow-step-fields">
                  {toolsError && <p role="alert">{toolsError}</p>}
                  {selectedStep && (
                    <>
                      <label>
                        Name
                        <Input
                          disabled={busy}
                          onChange={(event) =>
                            updateStep(selectedStep.key, {
                              id: event.target.value,
                            })
                          }
                          value={selectedStep.id}
                        />
                      </label>
                      {(stepFields[selectedStep.kind] ?? []).map((field) =>
                        field === "tool" ? (
                          <label key={field}>
                            Tool
                            <Choice
                              disabled={busy}
                              label="Tool"
                              onChange={(value) =>
                                updateStep(selectedStep.key, {
                                  fields: {
                                    ...selectedStep.fields,
                                    tool: value,
                                  },
                                })
                              }
                              options={Array.from(
                                new Set(
                                  [
                                    selectedStep.fields.tool,
                                    ...tools.map((tool) => tool.name),
                                  ].filter((name): name is string =>
                                    Boolean(name)
                                  )
                                )
                              ).map((name) => ({ label: name, value: name }))}
                              value={selectedStep.fields.tool ?? ""}
                            />
                          </label>
                        ) : field === "op" ? (
                          <Choice
                            disabled={busy}
                            key={field}
                            label="Operator"
                            onChange={(value) =>
                              updateStep(selectedStep.key, {
                                fields: {
                                  ...selectedStep.fields,
                                  [field]: value,
                                },
                              })
                            }
                            options={["eq", "near", "contains"].map((op) => ({
                              label: op,
                              value: op,
                            }))}
                            value={selectedStep.fields[field] ?? "eq"}
                          />
                        ) : (
                          <label key={field}>
                            {field === "input" ? "Input" : title(field)}
                            <Textarea
                              disabled={busy}
                              onChange={(event) =>
                                updateStep(selectedStep.key, {
                                  fields: {
                                    ...selectedStep.fields,
                                    [field]: event.target.value,
                                  },
                                })
                              }
                              rows={
                                field === "input" || field === "template"
                                  ? 8
                                  : 2
                              }
                              value={selectedStep.fields[field] ?? ""}
                            />
                          </label>
                        )
                      )}
                    </>
                  )}
                  {selection === "summary" && (
                    <label>
                      Summary instructions
                      <Textarea
                        disabled={busy}
                        onChange={(event) => setSummary(event.target.value)}
                        rows={8}
                        value={summary}
                      />
                    </label>
                  )}
                </div>
              )}
              {(selection === "data" || panelTab === "database") && (
                <DatabasePanel />
              )}
              {selection !== "data" &&
                panelTab === "test" &&
                (() => {
                  const receipt = runs[0]?.steps?.find(
                    (step) =>
                      step.stepId ===
                      (selectedStep?.id ?? summaryStep?.id ?? "summary")
                  );
                  return receipt ? (
                    <div className="workflow-step-fields">
                      <p>{receipt.status}</p>
                      {receipt.error && <p role="alert">{receipt.error}</p>}
                      <label>
                        Input<pre>{JSON.stringify(receipt.input, null, 2)}</pre>
                      </label>
                      <label>
                        Output
                        <pre>{JSON.stringify(receipt.output, null, 2)}</pre>
                      </label>
                    </div>
                  ) : (
                    <p className="workflow-empty">
                      No test results yet. Run the workflow to see this step’s
                      input and output.
                    </p>
                  );
                })()}
            </div>
          </aside>
        )}
        <Dialog
          onOpenChange={(open) => {
            if (!(open || busy)) {
              setSelection("");
            }
          }}
          open={selection === "input"}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Run input</DialogTitle>
            </DialogHeader>
            <div
              className="workflow-step-fields"
              style={{
                display: "grid",
                gap: 16,
                maxHeight: "65dvh",
                overflowY: "auto",
              }}
            >
              {selection === "input" && (
                <label>
                  Run input (JSON)
                  <Textarea
                    disabled={busy}
                    onChange={(event) => setRunInput(event.target.value)}
                    rows={8}
                    spellCheck={false}
                    value={runInput}
                  />
                </label>
              )}
            </div>
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => setSelection("")}
                type="button"
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          onOpenChange={(open) => {
            if (!busy) {
              setConfirmDelete(open);
            }
          }}
          open={confirmDelete}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete workflow?</DialogTitle>
              <DialogDescription>
                This removes the workflow and its run history permanently.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await action("delete_workflow", {
                      workflowId: workflow!.id,
                    });
                    if (mounted.current) {
                      await onSaved();
                    }
                  })
                }
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  function DatabasePanel() {
    const [table, setTable] = React.useState("");
    const [data, setData] = React.useState<{
      tables: Array<{ name: string }>;
      preview?: unknown;
    } | null>(null);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      let active = true;
      setLoading(true);
      setError("");
      action<{ tables: Array<{ name: string }>; preview?: unknown }>(
        "database",
        table ? { table } : {}
      )
        .then((result) => {
          if (active) {
            setData(result);
          }
        })
        .catch((error) => {
          if (active) {
            setError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, [table, retry]);
    return (
      <div aria-busy={loading} className="workflow-step-fields">
        {error ? (
          <div>
            <p role="alert">{error}</p>
            <Button
              onClick={() => setRetry((value) => value + 1)}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {Boolean(data?.tables.length) && (
          <Choice
            disabled={loading}
            label="Table"
            onChange={setTable}
            options={(data?.tables ?? []).map((entry) => ({
              label: entry.name,
              value: entry.name,
            }))}
            value={table}
          />
        )}
        {loading ? (
          <p className="workflow-empty" role="status">
            Loading data…
          </p>
        ) : (
          !error &&
          (data?.tables.length ? (
            table ? (
              data.preview == null ? (
                <p className="workflow-empty">No preview available.</p>
              ) : (
                <pre>{JSON.stringify(data.preview, null, 2)}</pre>
              )
            ) : (
              <p className="workflow-empty">
                Select a table to preview its data.
              </p>
            )
          ) : (
            <div className="workflow-empty">
              <p>No tables yet.</p>
              <p>Add a database step and run it to store data here.</p>
            </div>
          ))
        )}
      </div>
    );
  }

  ctx.slots.register("page", WorkflowsPage);
}
