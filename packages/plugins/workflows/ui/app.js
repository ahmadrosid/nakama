// ui/style.css
var style_default = `[data-plugin-id="workflows"] {
  * {
    box-sizing: border-box;
  }
  & {
    max-width: 1200px;
    padding: 24px;
    margin: auto;
  }
  header,
  .buttons,
  .fields {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  header {
    justify-content: space-between;
    margin-bottom: 24px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
  }
  h2 {
    font-size: 16px;
  }
  .layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 24px;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  nav button {
    text-align: left;
    overflow-wrap: anywhere;
  }
  nav button[aria-current="true"] {
    font-weight: 600;
    background: var(--accent);
  }
  button,
  input,
  select,
  textarea {
    padding: 8px 12px;
    font: inherit;
    color: inherit;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  button {
    cursor: pointer;
  }
  button:hover {
    background: var(--accent);
  }
  button:disabled {
    cursor: wait;
    opacity: 0.5;
  }
  input,
  select,
  textarea {
    width: 100%;
    min-width: 0;
  }
  textarea {
    resize: vertical;
  }
  label {
    display: block;
    margin-bottom: 16px;
  }
  label > input,
  label > textarea,
  label > select {
    display: block;
    margin-top: 6px;
  }
  .fields > label {
    flex: 1;
    min-width: 0;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .check input {
    width: auto;
    margin: 0;
  }
  .buttons {
    flex-wrap: wrap;
    margin: 20px 0;
  }
  fieldset {
    padding: 16px;
    margin: 0 0 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  [role="alert"] {
    padding: 12px;
    color: #cc4545;
    border: 1px solid #ce5a5a;
    border-radius: 6px;
  }
  details {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
  }
  pre {
    padding: 12px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    background: var(--card);
    border-radius: 6px;
  }
  :focus-visible {
    outline: 2px solid #6685ff;
    outline-offset: 2px;
  }
  @media (max-width: 700px) {
    & {
      padding: 16px;
    }
    .layout {
      grid-template-columns: 1fr;
    }
    nav {
      max-height: 180px;
      overflow: auto;
    }
    .fields {
      display: block;
    }
  }

  .editor-fields {
    padding: 0;
    border: 0;
  }
}
`;

// src/ui.tsx
var inject = ["slots", "host", "styles"];
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
    }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("h1", null, "Workflows"), /* @__PURE__ */ React.createElement("button", {
      onClick: () => setSelectedId(null),
      type: "button"
    }, "New workflow")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), data ? /* @__PURE__ */ React.createElement("div", {
      className: "layout"
    }, /* @__PURE__ */ React.createElement("nav", {
      "aria-label": "Workflows"
    }, data.workflows.map((workflow) => /* @__PURE__ */ React.createElement("button", {
      "aria-current": selectedId === workflow.id,
      key: workflow.id,
      onClick: () => setSelectedId(workflow.id),
      type: "button"
    }, workflow.name)), !data.workflows.length && /* @__PURE__ */ React.createElement("p", null, "No workflows yet")), /* @__PURE__ */ React.createElement(Editor, {
      key: `${selected?.id ?? "new"}:${selected?.version ?? 0}`,
      onSaved: saved,
      profiles: data.profiles,
      workflow: selected
    })) : /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, error ? "Unavailable" : "Loading…"), /* @__PURE__ */ React.createElement(DatabasePanel, null));
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
    return /* @__PURE__ */ React.createElement("section", null, error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement("form", {
      onSubmit: save
    }, /* @__PURE__ */ React.createElement("fieldset", {
      className: "editor-fields",
      disabled: busy
    }, /* @__PURE__ */ React.createElement("div", {
      className: "fields"
    }, /* @__PURE__ */ React.createElement("label", null, "Name", /* @__PURE__ */ React.createElement("input", {
      maxLength: 200,
      onChange: (e) => setName(e.target.value),
      required: true,
      value: name
    })), /* @__PURE__ */ React.createElement("label", null, "Agent", /* @__PURE__ */ React.createElement("select", {
      onChange: (e) => setAgentId(e.target.value),
      required: true,
      value: agentId
    }, profiles.map((profile) => /* @__PURE__ */ React.createElement("option", {
      key: profile.id,
      value: profile.id
    }, profile.name))))), /* @__PURE__ */ React.createElement("label", null, "Description", /* @__PURE__ */ React.createElement("input", {
      onChange: (e) => setDescription(e.target.value),
      value: description
    })), /* @__PURE__ */ React.createElement("label", {
      className: "check"
    }, /* @__PURE__ */ React.createElement("input", {
      checked: enabled,
      onChange: (e) => setEnabled(e.target.checked),
      type: "checkbox"
    }), "Enabled"), steps.map((step, index) => /* @__PURE__ */ React.createElement("fieldset", {
      key: step.key
    }, /* @__PURE__ */ React.createElement("legend", null, "Step ", index + 1), /* @__PURE__ */ React.createElement("label", null, "Step ID", /* @__PURE__ */ React.createElement("input", {
      onChange: (e) => updateStep(step.key, { id: e.target.value }),
      required: true,
      value: step.id
    })), /* @__PURE__ */ React.createElement("label", null, "Kind", /* @__PURE__ */ React.createElement("select", {
      onChange: (e) => updateStep(step.key, {
        fields: e.target.value === "compare" ? { op: "eq" } : {},
        kind: e.target.value
      }),
      value: step.kind
    }, Object.keys(stepFields).map((kind) => /* @__PURE__ */ React.createElement("option", {
      key: kind,
      value: kind
    }, kind)))), (stepFields[step.kind] ?? []).map((field) => /* @__PURE__ */ React.createElement("label", {
      key: field
    }, field === "input" ? "Tool arguments (JSON)" : field.charAt(0).toUpperCase() + field.slice(1), field === "op" ? /* @__PURE__ */ React.createElement("select", {
      onChange: (e) => updateStep(step.key, {
        fields: { ...step.fields, [field]: e.target.value }
      }),
      value: step.fields[field] ?? "eq"
    }, ["eq", "near", "contains"].map((op) => /* @__PURE__ */ React.createElement("option", {
      key: op,
      value: op
    }, op))) : /* @__PURE__ */ React.createElement("input", {
      onChange: (e) => updateStep(step.key, {
        fields: { ...step.fields, [field]: e.target.value }
      }),
      value: step.fields[field] ?? ""
    }))), /* @__PURE__ */ React.createElement("div", {
      className: "buttons"
    }, /* @__PURE__ */ React.createElement("button", {
      disabled: index === 0,
      onClick: () => moveStep(step.key, -1),
      type: "button"
    }, "Move up"), /* @__PURE__ */ React.createElement("button", {
      disabled: index === steps.length - 1,
      onClick: () => moveStep(step.key, 1),
      type: "button"
    }, "Move down"), /* @__PURE__ */ React.createElement("button", {
      onClick: () => setSteps((current) => current.filter((item) => item.key !== step.key)),
      type: "button"
    }, "Remove")))), /* @__PURE__ */ React.createElement("button", {
      onClick: () => setSteps((current) => [
        ...current,
        {
          fields: { input: "{}", tool: "web_fetch" },
          id: `step_${crypto.randomUUID().slice(0, 8)}`,
          key: crypto.randomUUID(),
          kind: "tool"
        }
      ]),
      type: "button"
    }, "Add step"), /* @__PURE__ */ React.createElement("label", null, "Summary instructions", /* @__PURE__ */ React.createElement("textarea", {
      onChange: (e) => setSummary(e.target.value),
      required: true,
      rows: 3,
      value: summary
    })), /* @__PURE__ */ React.createElement("div", {
      className: "buttons"
    }, /* @__PURE__ */ React.createElement("button", {
      type: "submit"
    }, "Save"), /* @__PURE__ */ React.createElement("button", {
      disabled: !workflow,
      onClick: () => void perform(async () => {
        const result = await action("run_workflow", {
          input: JSON.parse(runInput || "{}"),
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
      }),
      type: "button"
    }, "Run"), /* @__PURE__ */ React.createElement("button", {
      disabled: !workflow,
      onClick: () => setConfirmDelete(true),
      type: "button"
    }, "Delete")), confirmDelete && /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Confirm deletion",
      role: "group"
    }, /* @__PURE__ */ React.createElement("p", null, "Delete workflow and its run history?"), /* @__PURE__ */ React.createElement("button", {
      onClick: () => setConfirmDelete(false),
      type: "button"
    }, "Cancel"), /* @__PURE__ */ React.createElement("button", {
      onClick: () => void perform(async () => {
        await action("delete_workflow", {
          workflowId: workflow.id
        });
        if (mounted.current) {
          await onSaved();
        }
      }),
      type: "button"
    }, "Confirm delete")), /* @__PURE__ */ React.createElement("label", null, "Run input", /* @__PURE__ */ React.createElement("textarea", {
      onChange: (e) => setRunInput(e.target.value),
      rows: 2,
      value: runInput
    })))), busy && /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, "Working…"), workflow && /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Run history"
    }, /* @__PURE__ */ React.createElement("h2", null, "Run history"), runs.map((run) => /* @__PURE__ */ React.createElement("details", {
      key: run.id
    }, /* @__PURE__ */ React.createElement("summary", null, run.status, " · ", new Date(run.startedAt).toLocaleString()), (run.error || run.output) && /* @__PURE__ */ React.createElement("pre", null, run.error || run.output), (run.steps ?? []).map((step) => /* @__PURE__ */ React.createElement("div", {
      key: step.id
    }, /* @__PURE__ */ React.createElement("h3", null, step.stepId, " · ", step.status), /* @__PURE__ */ React.createElement("pre", null, JSON.stringify({
      error: step.error,
      input: step.input,
      output: step.output
    }, null, 2))))))));
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
      }
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
