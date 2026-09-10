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
            : JSON.stringify(value),
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
  const { Button } = ctx.ui;
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
          <>
            <div className="workflow-picker">
              <select
                aria-label="Select workflow"
                onChange={(event) => setSelectedId(event.target.value || null)}
                value={selectedId ?? ""}
              >
                <option value="">New workflow</option>
                {data.workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
              <Button onClick={() => setSelectedId(null)} type="button">
                New workflow
              </Button>
            </div>
            <Editor
              key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`}
              onSaved={saved}
              profiles={data.profiles}
              workflow={selected}
            />
          </>
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
    const [tab, setTab] = React.useState<"canvas" | "runs" | "data">("canvas");
    const [selection, setSelection] = React.useState("settings");
    const [zoom, setZoom] = React.useState(100);
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
          setTab("canvas");
          setSelection(summary.trim() ? "settings" : "summary");
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
    const addStep = () => {
      const step: StepDraft = {
        fields: { input: "{}", tool: "web_fetch" },
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
    const lastRun = runs[0];
    return (
      <section className="workflow-editor">
        <form onSubmit={save}>
          <fieldset className="editor-fields" disabled={busy}>
            <header className="editor-toolbar">
              <div className="workflow-title">
                <input
                  aria-label="Workflow name"
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Untitled workflow"
                  required
                  value={name}
                />
                <span className="workflow-state">
                  {workflow
                    ? dirty
                      ? "Unsaved"
                      : enabled
                        ? "Enabled"
                        : "Disabled"
                    : "Draft"}
                </span>
              </div>
              <div className="buttons">
                <button type="submit">{busy ? "Working…" : "Save"}</button>
                <button
                  className="primary"
                  onClick={() => setTab("runs")}
                  type="button"
                >
                  Run
                </button>
              </div>
            </header>
            <nav aria-label="Workflow views" className="view-tabs">
              {(["canvas", "runs", "data"] as const).map((view) => (
                <button
                  aria-current={tab === view ? "page" : undefined}
                  key={view}
                  onClick={() => setTab(view)}
                  type="button"
                >
                  {view.charAt(0).toUpperCase() + view.slice(1)}
                </button>
              ))}
              <button
                aria-pressed={tab === "canvas" && selection === "settings"}
                className="settings-button"
                onClick={() => {
                  setTab("canvas");
                  setSelection("settings");
                }}
                type="button"
              >
                Settings
              </button>
            </nav>
            {error && <p role="alert">{error}</p>}
            {tab === "canvas" && (
              <div className="canvas-layout">
                <div className="canvas-area">
                  <div aria-label="Canvas zoom" className="canvas-controls">
                    <button
                      aria-label="Zoom out"
                      disabled={zoom <= 60}
                      onClick={() =>
                        setZoom((current) => Math.max(60, current - 20))
                      }
                      type="button"
                    >
                      Zoom out
                    </button>
                    <button
                      aria-label="Reset zoom"
                      onClick={() => setZoom(100)}
                      type="button"
                    >
                      {zoom}%
                    </button>
                    <button
                      aria-label="Zoom in"
                      disabled={zoom >= 140}
                      onClick={() =>
                        setZoom((current) => Math.min(140, current + 20))
                      }
                      type="button"
                    >
                      Zoom in
                    </button>
                  </div>
                  <div
                    aria-label="Workflow canvas"
                    className="canvas-viewport"
                    role="region"
                  >
                    <ol className="workflow-track" style={{ zoom: zoom / 100 }}>
                      <li>
                        <button
                          aria-pressed={selection === "input"}
                          className="workflow-node input-node"
                          onClick={() => setSelection("input")}
                          type="button"
                        >
                          <span className="node-kind">Start</span>
                          <strong>Input</strong>
                          <span className="node-description">Run input</span>
                        </button>
                      </li>
                      {steps.map((step, index) => (
                        <li key={step.key}>
                          <button
                            aria-pressed={selection === step.key}
                            className="workflow-node"
                            onClick={() => setSelection(step.key)}
                            type="button"
                          >
                            <span className="node-kind">
                              Step {index + 1} · {step.kind}
                            </span>
                            <strong>{step.id || "Untitled step"}</strong>
                            <span className="node-description">
                              {step.fields.tool ||
                                step.fields.template ||
                                step.fields.path ||
                                "Compare values"}
                            </span>
                          </button>
                        </li>
                      ))}
                      <li className="add-node">
                        <button onClick={addStep} type="button">
                          Add step
                        </button>
                      </li>
                      <li>
                        <button
                          aria-pressed={selection === "summary"}
                          className="workflow-node summary-node"
                          onClick={() => setSelection("summary")}
                          type="button"
                        >
                          <span className="node-kind">Output</span>
                          <strong>Summary</strong>
                          <span className="node-description">
                            {profiles.find((profile) => profile.id === agentId)
                              ?.name || "Choose an agent"}
                          </span>
                        </button>
                      </li>
                    </ol>
                  </div>
                  <footer className="canvas-status">
                    <span
                      className="run-status"
                      data-status={lastRun?.status}
                      role="status"
                    >
                      {lastRun
                        ? `Last run ${lastRun.status} · ${new Date(lastRun.startedAt).toLocaleString()}`
                        : "No runs yet"}
                    </span>
                    <button onClick={() => setTab("runs")} type="button">
                      View runs
                    </button>
                  </footer>
                </div>
                <aside
                  aria-label="Workflow inspector"
                  className="workflow-inspector"
                >
                  <h2>
                    {selectedStep
                      ? "Step details"
                      : selection === "input"
                        ? "Input"
                        : selection === "summary"
                          ? "Summary"
                          : "Workflow settings"}
                  </h2>
                  {selection === "settings" && (
                    <>
                      <label>
                        Agent
                        <select
                          onChange={(event) => setAgentId(event.target.value)}
                          value={agentId}
                        >
                          {!profiles.length && (
                            <option value="">No agents available</option>
                          )}
                          {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Description
                        <textarea
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                          rows={3}
                          value={description}
                        />
                      </label>
                      <label className="check">
                        <input
                          checked={enabled}
                          onChange={(event) => setEnabled(event.target.checked)}
                          type="checkbox"
                        />
                        Enabled
                      </label>
                      {workflow && (
                        <div className="danger-zone">
                          {confirmDelete ? (
                            <div aria-label="Confirm deletion" role="group">
                              <p>Delete workflow and its run history?</p>
                              <div className="buttons">
                                <button
                                  onClick={() => setConfirmDelete(false)}
                                  type="button"
                                >
                                  Cancel
                                </button>
                                <button
                                  className="danger"
                                  onClick={() =>
                                    void perform(async () => {
                                      await action("delete_workflow", {
                                        workflowId: workflow.id,
                                      });
                                      if (mounted.current) {
                                        await onSaved();
                                      }
                                    })
                                  }
                                  type="button"
                                >
                                  Confirm delete
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="danger"
                              onClick={() => setConfirmDelete(true)}
                              type="button"
                            >
                              Delete workflow
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {selection === "input" && (
                    <label>
                      Run input (JSON)
                      <textarea
                        className="code-input"
                        onChange={(event) => setRunInput(event.target.value)}
                        rows={8}
                        spellCheck={false}
                        value={runInput}
                      />
                    </label>
                  )}
                  {selection === "summary" && (
                    <label>
                      Summary instructions
                      <textarea
                        onChange={(event) => setSummary(event.target.value)}
                        rows={8}
                        value={summary}
                      />
                    </label>
                  )}
                  {selectedStep && (
                    <>
                      <label>
                        Step ID
                        <input
                          onChange={(event) =>
                            updateStep(selectedStep.key, {
                              id: event.target.value,
                            })
                          }
                          value={selectedStep.id}
                        />
                      </label>
                      <label>
                        Kind
                        <select
                          onChange={(event) =>
                            updateStep(selectedStep.key, {
                              fields:
                                event.target.value === "compare"
                                  ? { op: "eq" }
                                  : {},
                              kind: event.target.value,
                            })
                          }
                          value={selectedStep.kind}
                        >
                          {Object.keys(stepFields).map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(stepFields[selectedStep.kind] ?? []).map((field) => (
                        <label key={field}>
                          {field === "input"
                            ? "Tool arguments (JSON)"
                            : field.charAt(0).toUpperCase() + field.slice(1)}
                          {field === "op" ? (
                            <select
                              onChange={(event) =>
                                updateStep(selectedStep.key, {
                                  fields: {
                                    ...selectedStep.fields,
                                    [field]: event.target.value,
                                  },
                                })
                              }
                              value={selectedStep.fields[field] ?? "eq"}
                            >
                              {["eq", "near", "contains"].map((op) => (
                                <option key={op} value={op}>
                                  {op}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <textarea
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
                                  ? 5
                                  : 2
                              }
                              value={selectedStep.fields[field] ?? ""}
                            />
                          )}
                        </label>
                      ))}
                      <div className="buttons step-actions">
                        <button
                          disabled={selectedIndex === 0}
                          onClick={() => moveStep(selectedStep.key, -1)}
                          type="button"
                        >
                          Move earlier
                        </button>
                        <button
                          disabled={selectedIndex === steps.length - 1}
                          onClick={() => moveStep(selectedStep.key, 1)}
                          type="button"
                        >
                          Move later
                        </button>
                      </div>
                      <button
                        className="danger"
                        onClick={() => {
                          setSteps((current) =>
                            current.filter(
                              (step) => step.key !== selectedStep.key
                            )
                          );
                          setSelection("settings");
                        }}
                        type="button"
                      >
                        Delete step
                      </button>
                    </>
                  )}
                </aside>
              </div>
            )}
            {tab === "runs" && (
              <section aria-label="Run history" className="workflow-panel">
                <div className="run-form">
                  <label>
                    Run input (JSON)
                    <textarea
                      className="code-input"
                      onChange={(event) => setRunInput(event.target.value)}
                      rows={4}
                      spellCheck={false}
                      value={runInput}
                    />
                  </label>
                  <div className="buttons">
                    <button
                      className="primary"
                      disabled={!workflow || dirty || !enabled}
                      onClick={runWorkflow}
                      type="button"
                    >
                      {busy ? "Running…" : "Run workflow"}
                    </button>
                    {(!workflow || dirty) && (
                      <span className="muted">
                        Save changes to run this workflow.
                      </span>
                    )}
                    {workflow && !dirty && !enabled && (
                      <span className="muted">
                        Enable and save this workflow to run it.
                      </span>
                    )}
                  </div>
                </div>
                <h2>Run history</h2>
                {!runs.length && <p className="empty-state">No runs yet</p>}
                {runs.map((run) => (
                  <details className="run-record" key={run.id}>
                    <summary>
                      <span className="run-status" data-status={run.status}>
                        {run.status}
                      </span>
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
            )}
            {tab === "data" && (
              <div className="workflow-panel">
                <DatabasePanel />
              </div>
            )}
          </fieldset>
        </form>
      </section>
    );
  }

  function DatabasePanel() {
    const [data, setData] = React.useState<{
      tables: Array<{ name: string }>;
      preview?: unknown;
    } | null>(null);
    const [error, setError] = React.useState("");
    const revision = React.useRef(0);
    React.useEffect(
      () => () => {
        revision.current++;
      },
      []
    );
    const load = async (table?: string) => {
      const current = ++revision.current;
      try {
        const result = await action<{
          tables: Array<{ name: string }>;
          preview?: unknown;
        }>("database", table ? { table } : {});
        if (current === revision.current) {
          setData(result);
          setError("");
        }
      } catch (error) {
        if (current === revision.current) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    return (
      <details
        onToggle={(event) => {
          if (event.currentTarget.open && !data) {
            void load();
          }
        }}
        open
      >
        <summary>Workflow data</summary>
        {error && <p role="alert">{error}</p>}
        <label>
          Table
          <select
            defaultValue=""
            onChange={(event) => void load(event.target.value)}
          >
            <option value="">Select a table</option>
            {data?.tables.map((table) => (
              <option key={table.name} value={table.name}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
        {data?.preview != null && (
          <pre>{JSON.stringify(data.preview, null, 2)}</pre>
        )}
      </details>
    );
  }
  ctx.slots.register("page", WorkflowsPage);
}
