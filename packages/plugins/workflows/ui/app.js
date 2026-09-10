// ui/style.css
var style_default = `[data-plugin-id="workflows"] {
  container-type: inline-size;

  * {
    box-sizing: border-box;
  }
  .workflows-page {
    min-width: 0;
    min-height: 100%;
    font-size: 13px;
    line-height: 1.5;
    color: var(--foreground);
  }
  button:not([data-slot]),
  input,
  select,
  textarea {
    min-width: 0;
    padding: 9px 12px;
    font: inherit;
    color: inherit;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  button:not([data-slot]) {
    min-height: 38px;
    cursor: pointer;
    transition:
      background-color 150ms,
      border-color 150ms;
  }
  button:not([data-slot]):hover:not(:disabled) {
    background: var(--accent);
  }
  button:not([data-slot]):disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  button.primary {
    font-weight: 600;
    color: var(--primary-foreground);
    background: var(--primary);
    border-color: var(--primary);
  }
  button.primary:hover:not(:disabled) {
    filter: brightness(0.94);
  }
  button.danger {
    color: var(--destructive);
  }
  input,
  select,
  textarea {
    width: 100%;
  }
  textarea {
    resize: vertical;
  }
  label {
    display: block;
    margin-bottom: 20px;
    font-weight: 500;
  }
  label > input,
  label > select,
  label > textarea {
    display: block;
    margin-top: 8px;
    font-weight: 400;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .check input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--primary);
  }
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  h2 {
    margin: 0 0 24px;
    font-size: 14px;
    font-weight: 600;
  }
  h3 {
    font-size: 13px;
  }
  .muted,
  .empty-state {
    color: var(--muted-foreground);
  }
  .workflow-picker {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-picker select {
    width: min(280px, 60%);
  }
  .workflow-picker button {
    white-space: nowrap;
  }
  .editor-fields {
    min-width: 0;
    padding: 0;
    margin: 0;
    border: 0;
  }
  .editor-toolbar {
    display: flex;
    gap: 24px;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
  }
  .workflow-title {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }
  .workflow-title input {
    width: 320px;
    max-width: 100%;
    padding: 6px 0;
    text-overflow: ellipsis;
    font-size: 18px;
    font-weight: 600;
    background: transparent;
    border-color: transparent;
  }
  .workflow-title input:hover {
    border-bottom-color: var(--border);
  }
  .workflow-state {
    padding: 3px 8px;
    font-size: 11px;
    color: var(--muted-foreground);
    white-space: nowrap;
    background: var(--muted);
    border-radius: 5px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .editor-toolbar .buttons {
    flex-shrink: 0;
  }
  .editor-toolbar .buttons button {
    min-width: 72px;
  }
  .view-tabs {
    display: flex;
    gap: 24px;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);
  }
  .view-tabs button {
    padding: 10px 0;
    color: var(--muted-foreground);
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }
  .view-tabs button[aria-current="page"] {
    color: var(--foreground);
    border-bottom-color: var(--primary);
  }
  .view-tabs .settings-button {
    margin-left: auto;
  }
  .canvas-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    min-height: 560px;
  }
  .canvas-area {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-image: radial-gradient(
      circle,
      var(--border) 1px,
      transparent 1px
    );
    background-size: 20px 20px;
  }
  .canvas-controls {
    display: flex;
    gap: 4px;
    align-self: flex-start;
    padding: 4px;
    margin: 20px;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .canvas-controls button {
    padding: 5px 10px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    background: transparent;
    border: 0;
  }
  .canvas-viewport {
    display: flex;
    flex: 1;
    align-items: center;
    min-height: 330px;
    overflow: auto;
  }
  .workflow-track {
    display: flex;
    align-items: center;
    justify-content: center;
    width: max-content;
    min-width: 100%;
    padding: 48px 32px 72px;
    margin: 0;
    list-style: none;
  }
  .workflow-track > li {
    position: relative;
    flex: 0 0 auto;
  }
  .workflow-track > li + li {
    margin-left: 36px;
  }
  .workflow-track > li + li::before {
    position: absolute;
    top: 50%;
    left: -36px;
    width: 36px;
    height: 1px;
    content: "";
    background: var(--muted-foreground);
    opacity: 0.5;
  }
  .workflow-track > li + li::after {
    position: absolute;
    top: calc(50% - 3px);
    left: -6px;
    width: 6px;
    height: 6px;
    content: "";
    border-top: 1px solid var(--muted-foreground);
    border-right: 1px solid var(--muted-foreground);
    transform: rotate(45deg);
  }
  button.workflow-node {
    display: flex;
    flex-direction: column;
    gap: 10px;
    justify-content: center;
    width: 176px;
    min-height: 138px;
    padding: 20px;
    text-align: left;
    background: var(--card);
    border-radius: 12px;
    box-shadow: 0 3px 12px #0000000a;
  }
  button.workflow-node[aria-pressed="true"] {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 15%, transparent);
  }
  .workflow-node strong {
    max-width: 100%;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .node-kind {
    font-size: 10px;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }
  .node-description {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .input-node .node-kind {
    color: var(--foreground);
  }
  .summary-node .node-kind {
    color: var(--primary);
  }
  .add-node button {
    font-size: 12px;
    background: var(--background);
    border-style: dashed;
  }
  .canvas-status {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    margin: 20px;
    font-size: 12px;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .canvas-status button {
    min-height: 32px;
    padding: 4px 8px;
    white-space: nowrap;
    background: transparent;
    border: 0;
  }
  .run-status {
    color: var(--muted-foreground);
  }
  .run-status[data-status="completed"] {
    color: var(--foreground);
  }
  .run-status[data-status="failed"] {
    color: var(--destructive);
  }
  .run-status[data-status="running"] {
    color: var(--primary);
  }
  .workflow-inspector {
    min-width: 0;
    padding: 24px;
    background: var(--background);
    border-left: 1px solid var(--border);
  }
  .step-actions {
    margin: 24px 0 12px;
  }
  .step-actions button {
    flex: 1;
    padding: 8px;
    font-size: 12px;
  }
  .danger-zone {
    padding-top: 20px;
    margin-top: 40px;
    border-top: 1px solid var(--border);
  }
  .workflow-panel {
    max-width: 960px;
    padding: 28px 24px;
    margin: 0 auto;
  }
  .run-form {
    margin-bottom: 36px;
  }
  .code-input,
  pre {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .empty-state {
    padding: 36px 20px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: 8px;
  }
  details {
    padding: 16px 0;
    border-top: 1px solid var(--border);
  }
  summary {
    font-weight: 500;
    cursor: pointer;
  }
  .run-record summary time {
    margin-left: 16px;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  details label {
    margin-top: 20px;
  }
  pre {
    max-width: 100%;
    padding: 16px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    background: var(--card);
    border-radius: 8px;
  }
  [role="alert"] {
    padding: 12px;
    margin: 16px 24px;
    color: var(--destructive);
    overflow-wrap: anywhere;
    border: 1px solid var(--destructive);
    border-radius: 8px;
  }

  @container (max-width: 860px) {
    .canvas-layout {
      grid-template-columns: minmax(0, 1fr) 260px;
    }
    .workflow-title {
      flex-wrap: wrap;
      gap: 4px;
    }
    .workflow-title input {
      width: 230px;
    }
    .workflow-inspector {
      padding: 20px;
    }
  }
  @container (max-width: 640px) {
    .workflow-picker,
    .editor-toolbar {
      padding: 12px 16px;
    }
    .editor-toolbar {
      flex-wrap: wrap;
      gap: 12px;
    }
    .workflow-title {
      flex: 1 1 100%;
    }
    .workflow-title input {
      flex: 1;
      width: auto;
    }
    .view-tabs {
      gap: 20px;
      padding: 0 16px;
    }
    .canvas-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .canvas-viewport {
      min-height: 260px;
    }
    .canvas-controls,
    .canvas-status {
      margin: 12px;
    }
    .workflow-inspector {
      border-top: 1px solid var(--border);
      border-left: 0;
    }
    .workflow-panel {
      padding: 24px 16px;
    }
    button:not([data-slot]) {
      min-height: 44px;
    }
  }
}
`;

// src/ui.tsx
var inject = ["slots", "host", "styles", "ui"];
var stepFields = {
  assert: ["path", "expected"],
  compare: ["left", "op", "right", "tolerance"],
  template: ["template"],
  tool: ["tool", "input"]
};
function parseValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function draftStep(step) {
  return {
    fields: Object.fromEntries(Object.entries(step).filter(([key]) => key !== "id" && key !== "kind").map(([key, value]) => [
      key,
      typeof value === "string" && !["left", "right", "expected", "tolerance"].includes(key) ? value : JSON.stringify(value)
    ])),
    id: step.id,
    key: crypto.randomUUID(),
    kind: step.kind
  };
}
function serializeSteps(steps) {
  return steps.map(({ id, kind, fields }) => ({
    id,
    kind,
    ...Object.fromEntries((stepFields[kind] ?? []).filter((key) => key !== "tolerance" || fields[key]).map((key) => [
      key,
      key === "input" ? JSON.parse(fields[key] || "{}") : ["left", "right", "expected", "tolerance"].includes(key) ? parseValue(fields[key] ?? "") : fields[key] ?? ""
    ]))
  }));
}
function apply(ctx) {
  const React = ctx.React;
  const { Button } = ctx.ui;
  ctx.styles(style_default);
  const action = async (name, input) => await ctx.host.call(name, input);
  function WorkflowsPage() {
    const [data, setData] = React.useState(null);
    const [selectedId, setSelectedId] = React.useState(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      let active = true;
      Promise.all([
        action("list_workflows"),
        action("profiles")
      ]).then(([workflows, profiles]) => {
        if (active) {
          setData({ profiles, workflows });
          setSelectedId(workflows[0]?.id ?? null);
        }
      }).catch((error2) => {
        if (active) {
          setError(String(error2.message ?? error2));
        }
      });
      return () => {
        active = false;
      };
    }, []);
    const saved = async (id) => {
      const workflows = await action("list_workflows");
      setData((current) => current && { ...current, workflows });
      setSelectedId((current) => current === selectedId ? id ?? workflows[0]?.id ?? null : current);
    };
    const selected = data?.workflows.find((workflow) => workflow.id === selectedId) ?? null;
    return /* @__PURE__ */ React.createElement("main", {
      className: "workflows-page"
    }, error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), data ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-picker"
    }, /* @__PURE__ */ React.createElement("select", {
      "aria-label": "Select workflow",
      onChange: (event) => setSelectedId(event.target.value || null),
      value: selectedId ?? ""
    }, /* @__PURE__ */ React.createElement("option", {
      value: ""
    }, "New workflow"), data.workflows.map((workflow) => /* @__PURE__ */ React.createElement("option", {
      key: workflow.id,
      value: workflow.id
    }, workflow.name))), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelectedId(null),
      type: "button"
    }, "New workflow")), /* @__PURE__ */ React.createElement(Editor, {
      key: `${selected?.id ?? "new"}:${selected?.version ?? 0}`,
      onSaved: saved,
      profiles: data.profiles,
      workflow: selected
    })) : /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, error ? "Unavailable" : "Loading…"));
  }
  function Editor({
    workflow,
    profiles,
    onSaved
  }) {
    const [name, setName] = React.useState(workflow?.name ?? "");
    const [description, setDescription] = React.useState(workflow?.description ?? "");
    const [agentId, setAgentId] = React.useState(workflow?.profileId ?? profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "");
    const [enabled, setEnabled] = React.useState(workflow?.enabled ?? true);
    const summaryStep = workflow?.steps.find((step) => step.kind === "summarize");
    const [summary, setSummary] = React.useState(summaryStep?.prompt ?? "Summarize only the step results.");
    const [steps, setSteps] = React.useState(() => (workflow?.steps.filter((step) => step.kind !== "summarize") ?? []).map(draftStep));
    const [runInput, setRunInput] = React.useState("{}");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [runs, setRuns] = React.useState([]);
    const [confirmDelete, setConfirmDelete] = React.useState(false);
    const [tab, setTab] = React.useState("canvas");
    const [selection, setSelection] = React.useState("settings");
    const [zoom, setZoom] = React.useState(100);
    const selectedIndex = steps.findIndex((step) => step.key === selection);
    const selectedStep = steps[selectedIndex];
    const initialDraft = React.useRef(JSON.stringify({ agentId, description, enabled, name, steps, summary }));
    const dirty = initialDraft.current !== JSON.stringify({ agentId, description, enabled, name, steps, summary });
    const mounted = React.useRef(true);
    const inFlight = React.useRef(false);
    React.useEffect(() => {
      mounted.current = true;
      if (workflow) {
        action("runs", { workflowId: workflow.id }).then((result) => {
          if (mounted.current) {
            setRuns(result);
          }
        }).catch((error2) => {
          if (mounted.current) {
            setError(String(error2.message ?? error2));
          }
        });
      }
      return () => {
        mounted.current = false;
      };
    }, [workflow]);
    const perform = async (work) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        await work();
      } catch (error2) {
        if (mounted.current) {
          setError(error2 instanceof Error ? error2.message : String(error2));
        }
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setBusy(false);
        }
      }
    };
    const save = (event) => {
      event.preventDefault();
      perform(async () => {
        if (!(name.trim() && agentId && summary.trim())) {
          setTab("canvas");
          setSelection(summary.trim() ? "settings" : "summary");
          throw new Error("Enter a workflow name, choose an agent, and add summary instructions.");
        }
        const result = await action(workflow ? "update_workflow" : "create_workflow", {
          agentId,
          description,
          enabled,
          name,
          steps: [
            ...serializeSteps(steps),
            {
              id: summaryStep?.id ?? "summary",
              kind: "summarize",
              prompt: summary
            }
          ],
          workflowId: workflow?.id
        });
        if (mounted.current) {
          await onSaved(result.id);
        }
      });
    };
    const updateStep = (key, update) => setSteps((current) => current.map((step) => step.key === key ? { ...step, ...update } : step));
    const moveStep = (key, delta) => setSteps((current) => {
      const next = [...current];
      const index = next.findIndex((step) => step.key === key);
      const target = index + delta;
      if (target >= 0 && target < next.length) {
        [next[index], next[target]] = [next[target], next[index]];
      }
      return next;
    });
    const addStep = () => {
      const step = {
        fields: { input: "{}", tool: "web_fetch" },
        id: `step_${crypto.randomUUID().slice(0, 8)}`,
        key: crypto.randomUUID(),
        kind: "tool"
      };
      setSteps((current) => [...current, step]);
      setSelection(step.key);
    };
    const runWorkflow = () => void perform(async () => {
      if (!workflow || dirty || !enabled) {
        return;
      }
      const input = JSON.parse(runInput || "{}");
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Run input must be a JSON object.");
      }
      const result = await action("run_workflow", {
        input,
        workflowId: workflow.id
      });
      const history = await action("runs", {
        workflowId: workflow.id
      });
      if (mounted.current) {
        setRuns(history);
      }
      if (result.error) {
        throw new Error(result.error);
      }
    });
    const lastRun = runs[0];
    return /* @__PURE__ */ React.createElement("section", {
      className: "workflow-editor"
    }, /* @__PURE__ */ React.createElement("form", {
      onSubmit: save
    }, /* @__PURE__ */ React.createElement("fieldset", {
      className: "editor-fields",
      disabled: busy
    }, /* @__PURE__ */ React.createElement("header", {
      className: "editor-toolbar"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-title"
    }, /* @__PURE__ */ React.createElement("input", {
      "aria-label": "Workflow name",
      maxLength: 200,
      onChange: (event) => setName(event.target.value),
      placeholder: "Untitled workflow",
      required: true,
      value: name
    }), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-state"
    }, workflow ? dirty ? "Unsaved" : enabled ? "Enabled" : "Disabled" : "Draft")), /* @__PURE__ */ React.createElement("div", {
      className: "buttons"
    }, /* @__PURE__ */ React.createElement("button", {
      type: "submit"
    }, busy ? "Working…" : "Save"), /* @__PURE__ */ React.createElement("button", {
      className: "primary",
      onClick: () => setTab("runs"),
      type: "button"
    }, "Run"))), /* @__PURE__ */ React.createElement("nav", {
      "aria-label": "Workflow views",
      className: "view-tabs"
    }, ["canvas", "runs", "data"].map((view) => /* @__PURE__ */ React.createElement("button", {
      "aria-current": tab === view ? "page" : undefined,
      key: view,
      onClick: () => setTab(view),
      type: "button"
    }, view.charAt(0).toUpperCase() + view.slice(1))), /* @__PURE__ */ React.createElement("button", {
      "aria-pressed": tab === "canvas" && selection === "settings",
      className: "settings-button",
      onClick: () => {
        setTab("canvas");
        setSelection("settings");
      },
      type: "button"
    }, "Settings")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), tab === "canvas" && /* @__PURE__ */ React.createElement("div", {
      className: "canvas-layout"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "canvas-area"
    }, /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Canvas zoom",
      className: "canvas-controls"
    }, /* @__PURE__ */ React.createElement("button", {
      "aria-label": "Zoom out",
      disabled: zoom <= 60,
      onClick: () => setZoom((current) => Math.max(60, current - 20)),
      type: "button"
    }, "Zoom out"), /* @__PURE__ */ React.createElement("button", {
      "aria-label": "Reset zoom",
      onClick: () => setZoom(100),
      type: "button"
    }, zoom, "%"), /* @__PURE__ */ React.createElement("button", {
      "aria-label": "Zoom in",
      disabled: zoom >= 140,
      onClick: () => setZoom((current) => Math.min(140, current + 20)),
      type: "button"
    }, "Zoom in")), /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Workflow canvas",
      className: "canvas-viewport",
      role: "region"
    }, /* @__PURE__ */ React.createElement("ol", {
      className: "workflow-track",
      style: { zoom: zoom / 100 }
    }, /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("button", {
      "aria-pressed": selection === "input",
      className: "workflow-node input-node",
      onClick: () => setSelection("input"),
      type: "button"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "node-kind"
    }, "Start"), /* @__PURE__ */ React.createElement("strong", null, "Input"), /* @__PURE__ */ React.createElement("span", {
      className: "node-description"
    }, "Run input"))), steps.map((step, index) => /* @__PURE__ */ React.createElement("li", {
      key: step.key
    }, /* @__PURE__ */ React.createElement("button", {
      "aria-pressed": selection === step.key,
      className: "workflow-node",
      onClick: () => setSelection(step.key),
      type: "button"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "node-kind"
    }, "Step ", index + 1, " · ", step.kind), /* @__PURE__ */ React.createElement("strong", null, step.id || "Untitled step"), /* @__PURE__ */ React.createElement("span", {
      className: "node-description"
    }, step.fields.tool || step.fields.template || step.fields.path || "Compare values")))), /* @__PURE__ */ React.createElement("li", {
      className: "add-node"
    }, /* @__PURE__ */ React.createElement("button", {
      onClick: addStep,
      type: "button"
    }, "Add step")), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("button", {
      "aria-pressed": selection === "summary",
      className: "workflow-node summary-node",
      onClick: () => setSelection("summary"),
      type: "button"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "node-kind"
    }, "Output"), /* @__PURE__ */ React.createElement("strong", null, "Summary"), /* @__PURE__ */ React.createElement("span", {
      className: "node-description"
    }, profiles.find((profile) => profile.id === agentId)?.name || "Choose an agent"))))), /* @__PURE__ */ React.createElement("footer", {
      className: "canvas-status"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "run-status",
      "data-status": lastRun?.status,
      role: "status"
    }, lastRun ? `Last run ${lastRun.status} · ${new Date(lastRun.startedAt).toLocaleString()}` : "No runs yet"), /* @__PURE__ */ React.createElement("button", {
      onClick: () => setTab("runs"),
      type: "button"
    }, "View runs"))), /* @__PURE__ */ React.createElement("aside", {
      "aria-label": "Workflow inspector",
      className: "workflow-inspector"
    }, /* @__PURE__ */ React.createElement("h2", null, selectedStep ? "Step details" : selection === "input" ? "Input" : selection === "summary" ? "Summary" : "Workflow settings"), selection === "settings" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", null, "Agent", /* @__PURE__ */ React.createElement("select", {
      onChange: (event) => setAgentId(event.target.value),
      value: agentId
    }, !profiles.length && /* @__PURE__ */ React.createElement("option", {
      value: ""
    }, "No agents available"), profiles.map((profile) => /* @__PURE__ */ React.createElement("option", {
      key: profile.id,
      value: profile.id
    }, profile.name)))), /* @__PURE__ */ React.createElement("label", null, "Description", /* @__PURE__ */ React.createElement("textarea", {
      onChange: (event) => setDescription(event.target.value),
      rows: 3,
      value: description
    })), /* @__PURE__ */ React.createElement("label", {
      className: "check"
    }, /* @__PURE__ */ React.createElement("input", {
      checked: enabled,
      onChange: (event) => setEnabled(event.target.checked),
      type: "checkbox"
    }), "Enabled"), workflow && /* @__PURE__ */ React.createElement("div", {
      className: "danger-zone"
    }, confirmDelete ? /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Confirm deletion",
      role: "group"
    }, /* @__PURE__ */ React.createElement("p", null, "Delete workflow and its run history?"), /* @__PURE__ */ React.createElement("div", {
      className: "buttons"
    }, /* @__PURE__ */ React.createElement("button", {
      onClick: () => setConfirmDelete(false),
      type: "button"
    }, "Cancel"), /* @__PURE__ */ React.createElement("button", {
      className: "danger",
      onClick: () => void perform(async () => {
        await action("delete_workflow", {
          workflowId: workflow.id
        });
        if (mounted.current) {
          await onSaved();
        }
      }),
      type: "button"
    }, "Confirm delete"))) : /* @__PURE__ */ React.createElement("button", {
      className: "danger",
      onClick: () => setConfirmDelete(true),
      type: "button"
    }, "Delete workflow"))), selection === "input" && /* @__PURE__ */ React.createElement("label", null, "Run input (JSON)", /* @__PURE__ */ React.createElement("textarea", {
      className: "code-input",
      onChange: (event) => setRunInput(event.target.value),
      rows: 8,
      spellCheck: false,
      value: runInput
    })), selection === "summary" && /* @__PURE__ */ React.createElement("label", null, "Summary instructions", /* @__PURE__ */ React.createElement("textarea", {
      onChange: (event) => setSummary(event.target.value),
      rows: 8,
      value: summary
    })), selectedStep && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", null, "Step ID", /* @__PURE__ */ React.createElement("input", {
      onChange: (event) => updateStep(selectedStep.key, {
        id: event.target.value
      }),
      value: selectedStep.id
    })), /* @__PURE__ */ React.createElement("label", null, "Kind", /* @__PURE__ */ React.createElement("select", {
      onChange: (event) => updateStep(selectedStep.key, {
        fields: event.target.value === "compare" ? { op: "eq" } : {},
        kind: event.target.value
      }),
      value: selectedStep.kind
    }, Object.keys(stepFields).map((kind) => /* @__PURE__ */ React.createElement("option", {
      key: kind,
      value: kind
    }, kind)))), (stepFields[selectedStep.kind] ?? []).map((field) => /* @__PURE__ */ React.createElement("label", {
      key: field
    }, field === "input" ? "Tool arguments (JSON)" : field.charAt(0).toUpperCase() + field.slice(1), field === "op" ? /* @__PURE__ */ React.createElement("select", {
      onChange: (event) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          [field]: event.target.value
        }
      }),
      value: selectedStep.fields[field] ?? "eq"
    }, ["eq", "near", "contains"].map((op) => /* @__PURE__ */ React.createElement("option", {
      key: op,
      value: op
    }, op))) : /* @__PURE__ */ React.createElement("textarea", {
      onChange: (event) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          [field]: event.target.value
        }
      }),
      rows: field === "input" || field === "template" ? 5 : 2,
      value: selectedStep.fields[field] ?? ""
    }))), /* @__PURE__ */ React.createElement("div", {
      className: "buttons step-actions"
    }, /* @__PURE__ */ React.createElement("button", {
      disabled: selectedIndex === 0,
      onClick: () => moveStep(selectedStep.key, -1),
      type: "button"
    }, "Move earlier"), /* @__PURE__ */ React.createElement("button", {
      disabled: selectedIndex === steps.length - 1,
      onClick: () => moveStep(selectedStep.key, 1),
      type: "button"
    }, "Move later")), /* @__PURE__ */ React.createElement("button", {
      className: "danger",
      onClick: () => {
        setSteps((current) => current.filter((step) => step.key !== selectedStep.key));
        setSelection("settings");
      },
      type: "button"
    }, "Delete step")))), tab === "runs" && /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Run history",
      className: "workflow-panel"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "run-form"
    }, /* @__PURE__ */ React.createElement("label", null, "Run input (JSON)", /* @__PURE__ */ React.createElement("textarea", {
      className: "code-input",
      onChange: (event) => setRunInput(event.target.value),
      rows: 4,
      spellCheck: false,
      value: runInput
    })), /* @__PURE__ */ React.createElement("div", {
      className: "buttons"
    }, /* @__PURE__ */ React.createElement("button", {
      className: "primary",
      disabled: !workflow || dirty || !enabled,
      onClick: runWorkflow,
      type: "button"
    }, busy ? "Running…" : "Run workflow"), (!workflow || dirty) && /* @__PURE__ */ React.createElement("span", {
      className: "muted"
    }, "Save changes to run this workflow."), workflow && !dirty && !enabled && /* @__PURE__ */ React.createElement("span", {
      className: "muted"
    }, "Enable and save this workflow to run it."))), /* @__PURE__ */ React.createElement("h2", null, "Run history"), !runs.length && /* @__PURE__ */ React.createElement("p", {
      className: "empty-state"
    }, "No runs yet"), runs.map((run) => /* @__PURE__ */ React.createElement("details", {
      className: "run-record",
      key: run.id
    }, /* @__PURE__ */ React.createElement("summary", null, /* @__PURE__ */ React.createElement("span", {
      className: "run-status",
      "data-status": run.status
    }, run.status), /* @__PURE__ */ React.createElement("time", {
      dateTime: run.startedAt
    }, new Date(run.startedAt).toLocaleString())), (run.error || run.output) && /* @__PURE__ */ React.createElement("pre", null, run.error || run.output), (run.steps ?? []).map((step) => /* @__PURE__ */ React.createElement("div", {
      key: step.id
    }, /* @__PURE__ */ React.createElement("h3", null, step.stepId, " · ", step.status), /* @__PURE__ */ React.createElement("pre", null, JSON.stringify({
      error: step.error,
      input: step.input,
      output: step.output
    }, null, 2))))))), tab === "data" && /* @__PURE__ */ React.createElement("div", {
      className: "workflow-panel"
    }, /* @__PURE__ */ React.createElement(DatabasePanel, null)))));
  }
  function DatabasePanel() {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState("");
    const revision = React.useRef(0);
    React.useEffect(() => () => {
      revision.current++;
    }, []);
    const load = async (table) => {
      const current = ++revision.current;
      try {
        const result = await action("database", table ? { table } : {});
        if (current === revision.current) {
          setData(result);
          setError("");
        }
      } catch (error2) {
        if (current === revision.current) {
          setError(error2 instanceof Error ? error2.message : String(error2));
        }
      }
    };
    return /* @__PURE__ */ React.createElement("details", {
      onToggle: (event) => {
        if (event.currentTarget.open && !data) {
          load();
        }
      },
      open: true
    }, /* @__PURE__ */ React.createElement("summary", null, "Workflow data"), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement("label", null, "Table", /* @__PURE__ */ React.createElement("select", {
      defaultValue: "",
      onChange: (event) => void load(event.target.value)
    }, /* @__PURE__ */ React.createElement("option", {
      value: ""
    }, "Select a table"), data?.tables.map((table) => /* @__PURE__ */ React.createElement("option", {
      key: table.name,
      value: table.name
    }, table.name)))), data?.preview != null && /* @__PURE__ */ React.createElement("pre", null, JSON.stringify(data.preview, null, 2)));
  }
  ctx.slots.register("page", WorkflowsPage);
}
export {
  apply,
  inject
};
