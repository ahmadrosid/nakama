/** @jsxRuntime classic */
/** @jsx React.createElement */

import type {
  StoredWorkflow,
  WorkflowRunRecord,
  WorkflowStep,
} from "@nakama/core/contract";
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
  signal: AbortSignal;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
};
export const inject = ["slots", "host", "styles"];
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
        <header>
          <h1>Workflows</h1>
          <button onClick={() => setSelectedId(null)} type="button">
            New workflow
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {data ? (
          <div className="layout">
            <nav aria-label="Workflows">
              {data.workflows.map((workflow) => (
                <button
                  aria-current={selectedId === workflow.id}
                  key={workflow.id}
                  onClick={() => setSelectedId(workflow.id)}
                  type="button"
                >
                  {workflow.name}
                </button>
              ))}
              {!data.workflows.length && <p>No workflows yet</p>}
            </nav>
            <Editor
              key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`}
              onSaved={saved}
              profiles={data.profiles}
              workflow={selected}
            />
          </div>
        ) : (
          <p role="status">{error ? "Unavailable" : "Loading…"}</p>
        )}
        <DatabasePanel />
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
    return (
      <section>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={save}>
          <fieldset className="editor-fields" disabled={busy}>
            <div className="fields">
              <label>
                Name
                <input
                  maxLength={200}
                  onChange={(e) => setName(e.target.value)}
                  required
                  value={name}
                />
              </label>
              <label>
                Agent
                <select
                  onChange={(e) => setAgentId(e.target.value)}
                  required
                  value={agentId}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Description
              <input
                onChange={(e) => setDescription(e.target.value)}
                value={description}
              />
            </label>
            <label className="check">
              <input
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                type="checkbox"
              />
              Enabled
            </label>
            {steps.map((step, index) => (
              <fieldset key={step.key}>
                <legend>Step {index + 1}</legend>
                <label>
                  Step ID
                  <input
                    onChange={(e) =>
                      updateStep(step.key, { id: e.target.value })
                    }
                    required
                    value={step.id}
                  />
                </label>
                <label>
                  Kind
                  <select
                    onChange={(e) =>
                      updateStep(step.key, {
                        fields:
                          e.target.value === "compare" ? { op: "eq" } : {},
                        kind: e.target.value,
                      })
                    }
                    value={step.kind}
                  >
                    {Object.keys(stepFields).map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
                {(stepFields[step.kind] ?? []).map((field) => (
                  <label key={field}>
                    {field === "input"
                      ? "Tool arguments (JSON)"
                      : field.charAt(0).toUpperCase() + field.slice(1)}
                    {field === "op" ? (
                      <select
                        onChange={(e) =>
                          updateStep(step.key, {
                            fields: { ...step.fields, [field]: e.target.value },
                          })
                        }
                        value={step.fields[field] ?? "eq"}
                      >
                        {["eq", "near", "contains"].map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        onChange={(e) =>
                          updateStep(step.key, {
                            fields: { ...step.fields, [field]: e.target.value },
                          })
                        }
                        value={step.fields[field] ?? ""}
                      />
                    )}
                  </label>
                ))}
                <div className="buttons">
                  <button
                    disabled={index === 0}
                    onClick={() => moveStep(step.key, -1)}
                    type="button"
                  >
                    Move up
                  </button>
                  <button
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(step.key, 1)}
                    type="button"
                  >
                    Move down
                  </button>
                  <button
                    onClick={() =>
                      setSteps((current) =>
                        current.filter((item) => item.key !== step.key)
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </fieldset>
            ))}
            <button
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  {
                    fields: { input: "{}", tool: "web_fetch" },
                    id: `step_${crypto.randomUUID().slice(0, 8)}`,
                    key: crypto.randomUUID(),
                    kind: "tool",
                  },
                ])
              }
              type="button"
            >
              Add step
            </button>
            <label>
              Summary instructions
              <textarea
                onChange={(e) => setSummary(e.target.value)}
                required
                rows={3}
                value={summary}
              />
            </label>
            <div className="buttons">
              <button type="submit">Save</button>
              <button
                disabled={!workflow}
                onClick={() =>
                  void perform(async () => {
                    const result = await action<{ error?: string }>(
                      "run_workflow",
                      {
                        input: JSON.parse(runInput || "{}"),
                        workflowId: workflow!.id,
                      }
                    );
                    const history = await action<WorkflowRunRecord[]>("runs", {
                      workflowId: workflow!.id,
                    });
                    if (mounted.current) {
                      setRuns(history);
                    }
                    if (result.error) {
                      throw new Error(result.error);
                    }
                  })
                }
                type="button"
              >
                Run
              </button>
              <button
                disabled={!workflow}
                onClick={() => setConfirmDelete(true)}
                type="button"
              >
                Delete
              </button>
            </div>
            {confirmDelete && (
              <div aria-label="Confirm deletion" role="group">
                <p>Delete workflow and its run history?</p>
                <button onClick={() => setConfirmDelete(false)} type="button">
                  Cancel
                </button>
                <button
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
                >
                  Confirm delete
                </button>
              </div>
            )}
            <label>
              Run input
              <textarea
                onChange={(e) => setRunInput(e.target.value)}
                rows={2}
                value={runInput}
              />
            </label>
          </fieldset>
        </form>
        {busy && <p role="status">Working…</p>}
        {workflow && (
          <section aria-label="Run history">
            <h2>Run history</h2>
            {runs.map((run) => (
              <details key={run.id}>
                <summary>
                  {run.status} · {new Date(run.startedAt).toLocaleString()}
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
