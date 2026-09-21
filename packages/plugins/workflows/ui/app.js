// ui/style.css
var style_default = `[data-plugin-id="workflows"] {
  &:has(> .workflows-page) {
    display: flex;
    flex-direction: column;
    padding: 0;
    container-type: inline-size;
    overflow: hidden;
  }

  .workflows-page {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--foreground);
  }
  .workflow-layout {
    display: grid;
    flex: 1;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }
  .workflow-sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }
  .workflow-sidebar ul,
  .workflow-steps {
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .workflow-sidebar li {
    border-bottom: 1px solid var(--border);
  }
  .workflow-list-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    width: 100%;
    height: auto;
    padding: 14px 12px;
    text-align: left;
    white-space: normal;
    border-radius: 0;
  }
  .workflow-list-item[aria-current="true"] {
    background: color-mix(in srgb, var(--muted) 35%, transparent);
  }
  .workflow-list-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    white-space: nowrap;
  }
  .workflow-list-meta,
  .workflow-list-state {
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-list-state {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .workflow-status-dot {
    width: 8px;
    height: 8px;
    background: var(--muted-foreground);
    border-radius: 50%;
  }
  .workflow-status-dot[data-enabled="true"] {
    background: #10b981;
  }
  .workflow-editor,
  .workflow-editor form,
  .editor-fields {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .editor-fields {
    padding: 0;
    margin: 0;
    border: 0;
  }
  .editor-toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    min-height: 54px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .editor-toolbar p {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    white-space: nowrap;
  }
  .workflow-actions,
  .workflow-add-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .workflow-scroll {
    flex: 1;
    min-height: 0;
    padding: 24px 20px;
    overflow-y: auto;
  }
  .workflow-content {
    width: 100%;
    max-width: 576px;
    margin-inline: auto;
  }
  .workflow-meta {
    margin-bottom: 24px;
  }
  .workflow-meta-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .workflow-name {
    flex: 1;
    min-width: 0;
    font-weight: 500;
  }
  .workflow-name,
  .workflow-description {
    border-color: transparent;
    box-shadow: none;
  }
  .workflow-description {
    margin-top: 4px;
    color: var(--muted-foreground);
  }
  .workflow-enabled {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
  }
  .workflow-meta-row [data-slot="select-trigger"] {
    min-width: 0;
    max-width: 176px;
  }
  .workflow-step-card {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-right: 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .workflow-step-card[data-selected="true"] {
    border-color: var(--ring);
  }
  .workflow-step-open {
    flex: 1;
    gap: 12px;
    justify-content: flex-start;
    min-width: 0;
    height: auto;
    min-height: 44px;
    padding: 10px 12px;
    text-align: left;
    overflow-wrap: anywhere;
    white-space: normal;
    border-radius: 16px;
  }
  .workflow-step-number {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 24px;
    height: 24px;
    font-size: 12px;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 50%;
  }
  .workflow-connector {
    width: 1px;
    height: 20px;
    margin-inline: auto;
    background: var(--border);
  }
  .workflow-add-actions {
    justify-content: center;
    margin-top: 16px;
  }
  .workflow-empty {
    color: var(--muted-foreground);
  }
  .workflow-run-record {
    padding-block: 12px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-run-record summary {
    cursor: pointer;
  }
  .workflow-run-duration {
    float: right;
    margin-left: 12px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted-foreground);
  }
  .workflow-run-record time {
    margin-left: 12px;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-run-record pre {
    max-height: 320px;
    overflow: auto;
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .workflow-error {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    margin: 16px 16px 0;
    color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 6%, var(--background));
    border: 1px solid color-mix(in srgb, var(--destructive) 25%, transparent);
    border-radius: 6px;
  }
  .workflow-error > svg {
    flex-shrink: 0;
  }
  .workflow-error p {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .workflow-error a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  @container (max-width: 760px) {
    .workflow-layout {
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-columns: minmax(0, 1fr);
    }
    .workflow-sidebar {
      max-height: 180px;
      overflow-y: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .workflow-meta-row {
      flex-wrap: wrap;
    }
    .workflow-name {
      flex-basis: 100%;
    }
    .editor-toolbar {
      flex-wrap: wrap;
    }
    .workflow-scroll {
      padding: 20px 12px;
    }
  }
}

[data-plugin-id="workflows"] {
  .workflow-editor {
    position: relative;
  }
  .workflow-step-drawer {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: min(352px, 100%);
    min-height: 0;
    outline: none;
    background: var(--background);
    border-left: 1px solid var(--border);
    box-shadow: -12px 0 32px #00000020;
  }
  .workflow-step-drawer[data-expanded="true"] {
    width: 100%;
    border-left: 0;
    box-shadow: none;
  }
  .workflow-drawer-header {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-drawer-title {
    flex: 1;
    min-width: 0;
  }
  .workflow-drawer-title h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .workflow-drawer-title p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-view-nav,
  .workflow-drawer-tabs {
    display: flex;
    gap: 16px;
    padding-inline: 16px;
    border-bottom: 1px solid var(--border);
  }
  .workflow-view-nav [data-slot="button"],
  .workflow-drawer-tabs [data-slot="button"] {
    height: 42px;
    padding-inline: 0;
    color: var(--muted-foreground);
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }
  .workflow-view-nav [data-slot="button"] {
    background: transparent;
  }
  .workflow-view-nav [aria-pressed="true"],
  .workflow-drawer-tabs [aria-pressed="true"] {
    color: var(--foreground);
    border-bottom-color: var(--foreground);
  }
  .workflow-drawer-body {
    flex: 1;
    min-height: 0;
    padding: 16px;
    overflow-y: auto;
  }
  .workflow-step-fields {
    display: grid;
    gap: 20px;
  }
  .workflow-step-fields label {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .workflow-step-fields [data-slot="select-trigger"] {
    width: 100%;
  }
  .workflow-step-fields textarea,
  .workflow-step-fields pre,
  .workflow-drawer-body pre {
    font-family: monospace;
    font-size: 13px;
  }
  .workflow-step-fields pre,
  .workflow-drawer-body pre {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
}

[data-plugin-id="workflows"] {
  .workflow-layout[data-empty="true"] {
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }
  .workflow-welcome {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 48px 24px;
    text-align: center;
  }
  .workflow-welcome-icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    color: var(--muted-foreground);
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    border: 1px solid var(--border);
    border-radius: 18px;
  }
  .workflow-welcome-icon svg {
    width: 28px;
    height: 28px;
  }
  .workflow-welcome h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
}

[data-plugin-id="workflows"] {
  .workflow-chat-card {
    min-width: 0;
    max-width: 100%;
    padding: 12px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .workflow-chat-card header {
    display: flex;
    gap: 12px;
    align-items: baseline;
  }
  .workflow-chat-card header {
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .workflow-chat-card h3,
  .workflow-chat-card p {
    margin: 0;
    font-size: 14px;
  }
  .workflow-chat-card h3 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    white-space: nowrap;
  }
  .workflow-chat-card header > span {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .workflow-chat-card > [role="alert"] {
    margin-bottom: 16px;
    overflow-wrap: anywhere;
  }
  .workflow-chat-card ol {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .workflow-chat-card li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) minmax(0, 28%);
    gap: 10px;
    align-items: baseline;
    min-width: 0;
  }
  .workflow-chat-card li > div {
    min-width: 0;
  }
  .workflow-chat-card li p,
  .workflow-chat-result {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workflow-chat-card header > span,
  .workflow-chat-card .workflow-chat-detail,
  .workflow-chat-result {
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .workflow-chat-result {
    min-width: 0;
    text-align: right;
  }
  .workflow-chat-card [data-status="completed"] .workflow-chat-mark {
    color: #10b981;
  }
  .workflow-chat-card [data-status="failed"],
  .workflow-chat-card [role="alert"] {
    color: var(--destructive);
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
      typeof value === "string" && !["left", "right", "expected", "tolerance"].includes(key) ? value : JSON.stringify(value, null, 2)
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
    Popover,
    PopoverTrigger,
    PopoverContent,
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandItem,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem
  } = ctx.ui;
  function Choice({
    label,
    value,
    options,
    onChange,
    disabled = false
  }) {
    return /* @__PURE__ */ React.createElement(Select, {
      disabled,
      onValueChange: (next) => {
        if (next !== null) {
          onChange(String(next));
        }
      },
      value
    }, /* @__PURE__ */ React.createElement(SelectTrigger, {
      "aria-label": label
    }, /* @__PURE__ */ React.createElement(SelectValue, null, options.find((option) => option.value === value)?.label ?? label)), /* @__PURE__ */ React.createElement(SelectContent, null, options.map((option) => /* @__PURE__ */ React.createElement(SelectItem, {
      key: option.value,
      value: option.value
    }, option.label))));
  }
  function ToolChoice({
    value,
    options,
    onChange,
    disabled
  }) {
    const [open, setOpen] = React.useState(false);
    return /* @__PURE__ */ React.createElement(Popover, {
      onOpenChange: setOpen,
      open
    }, /* @__PURE__ */ React.createElement(PopoverTrigger, {
      "aria-label": "Tool",
      disabled,
      render: /* @__PURE__ */ React.createElement(Button, {
        className: "w-full justify-between",
        variant: "outline"
      })
    }, /* @__PURE__ */ React.createElement("span", {
      className: "min-w-0 truncate"
    }, value || "Select tool"), /* @__PURE__ */ React.createElement("span", {
      "aria-hidden": "true"
    }, "⌄")), /* @__PURE__ */ React.createElement(PopoverContent, {
      className: "overflow-hidden p-0 shadow-sm"
    }, /* @__PURE__ */ React.createElement(Command, null, /* @__PURE__ */ React.createElement(CommandInput, {
      "aria-label": "Search tools",
      placeholder: "Search tools…"
    }), /* @__PURE__ */ React.createElement(CommandList, null, /* @__PURE__ */ React.createElement(CommandEmpty, null, "No tools found."), options.map((option) => /* @__PURE__ */ React.createElement(CommandItem, {
      "data-checked": value === option.value ? true : undefined,
      key: option.value,
      onSelect: () => {
        onChange(option.value);
        setOpen(false);
      },
      value: option.value
    }, /* @__PURE__ */ React.createElement("span", {
      className: "min-w-0 break-all"
    }, option.label)))))));
  }
  function Icon({
    kind
  }) {
    const paths = {
      add: "M12 5v14M5 12h14",
      close: "m6 6 12 12M6 18 18 6",
      collapse: "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7",
      delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7",
      expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
      more: "M5 12h.01M12 12h.01M19 12h.01",
      play: "m8 5 11 7-11 7V5Z",
      warning: "M12 3 2 21h20L12 3ZM12 9v5M12 17h.01",
      workflow: "M4 3h6v6H4V3ZM14 15h6v6h-6v-6ZM7 9v9h7M10 6h7v9"
    };
    return /* @__PURE__ */ React.createElement("svg", {
      "aria-hidden": "true",
      fill: "none",
      height: "16",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: kind === "more" ? 3 : 1.5,
      viewBox: "0 0 24 24",
      width: "16"
    }, /* @__PURE__ */ React.createElement("path", {
      d: paths[kind]
    }));
  }
  ctx.styles(style_default);
  function WorkflowError({ message }) {
    const connectionError = /^MCP server "([^"]+)" is not connected\.$/.exec(message);
    return /* @__PURE__ */ React.createElement("div", {
      className: "workflow-error",
      role: "alert"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "warning"
    }), /* @__PURE__ */ React.createElement("p", null, connectionError ? `${connectionError[1]} isn’t connected.` : message), connectionError ? /* @__PURE__ */ React.createElement("a", {
      href: "/system?tab=mcp"
    }, "Open MCP settings") : null);
  }
  const action = async (name, input) => await ctx.host.call(name, input);
  function WorkflowRunCard({ input, result, status }) {
    const workflowId = typeof input?.workflowId === "string" ? input.workflowId : null;
    const [workflow, setWorkflow] = React.useState(null);
    const [liveRun, setLiveRun] = React.useState(null);
    const record = result && typeof result === "object" ? result : null;
    React.useEffect(() => {
      if (!workflowId) {
        return;
      }
      let active = true;
      let timer;
      const load = async () => {
        try {
          const definition = await action("get_workflow", {
            workflowId
          });
          if (active) {
            setWorkflow(definition);
          }
          if (status === "running") {
            const runs = await action("runs", {
              workflowId
            });
            if (active) {
              setLiveRun(runs.find((run2) => run2.status === "running") ?? null);
            }
          }
        } catch {}
        if (active && status === "running") {
          timer = setTimeout(load, 1500);
        }
      };
      load();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [workflowId, status]);
    const run = record?.run ?? (status === "running" ? liveRun : null);
    const receipts = run?.steps ?? [];
    const steps = workflow?.steps ?? receipts.map((receipt) => ({ id: receipt.stepId, kind: receipt.kind }));
    const complete = receipts.filter((receipt) => receipt.status === "completed").length;
    const label = run?.status === "failed" || record?.error ? "Failed" : status === "running" ? "Running" : run?.status === "completed" ? "Done" : "Finished";
    return /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Workflow run",
      className: "workflow-chat-card"
    }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("h3", null, workflow?.name ?? record?.name ?? "Workflow"), /* @__PURE__ */ React.createElement("span", null, label, steps.length ? ` · ${complete} of ${steps.length}` : "")), run?.error || record?.error ? /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, run?.error ?? record?.error) : null, /* @__PURE__ */ React.createElement("ol", null, steps.map((step) => {
      const receipt = receipts.find((item) => item.stepId === step.id);
      const stepStatus = receipt?.status ?? "pending";
      const definition = workflow?.steps.find((item) => item.id === step.id);
      const detail = definition?.kind === "tool" ? definition.tool : definition?.kind === "summarize" ? definition.prompt : definition?.kind === "template" ? definition.template : step.kind;
      const output = receipt?.output;
      const content = output && typeof output === "object" && "content" in output ? output.content : null;
      const meta = receipt?.error ?? (typeof content === "string" ? `${content.trim().split(/\s+/).filter(Boolean).length} words` : stepStatus === "completed" ? step.kind === "summarize" ? "Written" : "Done" : stepStatus);
      return /* @__PURE__ */ React.createElement("li", {
        "data-status": stepStatus,
        key: step.id
      }, /* @__PURE__ */ React.createElement("span", {
        "aria-label": stepStatus,
        className: "workflow-chat-mark"
      }, stepStatus === "completed" ? "✓" : stepStatus === "failed" ? "×" : "○"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, step.id.replaceAll(/[_-]+/g, " ").replaceAll(/\b\w/g, (letter) => letter.toUpperCase())), /* @__PURE__ */ React.createElement("p", {
        className: "workflow-chat-detail"
      }, detail)), /* @__PURE__ */ React.createElement("span", {
        className: "workflow-chat-result"
      }, meta));
    })));
  }
  function WorkflowsPage({
    renderHeaderActions = (children) => children
  }) {
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
    }, data && renderHeaderActions(/* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelectedId(""),
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "New workflow")), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), data ? /* @__PURE__ */ React.createElement("div", {
      className: "workflow-layout",
      "data-empty": data.workflows.length === 0
    }, data.workflows.length > 0 && /* @__PURE__ */ React.createElement("aside", {
      "aria-label": "Workflows",
      className: "workflow-sidebar"
    }, /* @__PURE__ */ React.createElement("ul", null, data.workflows.map((workflow) => /* @__PURE__ */ React.createElement("li", {
      key: workflow.id
    }, /* @__PURE__ */ React.createElement(Button, {
      "aria-current": selectedId === workflow.id ? "true" : undefined,
      className: "workflow-list-item",
      onClick: () => setSelectedId(workflow.id),
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-list-name"
    }, workflow.name), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-list-meta"
    }, workflow.steps.length, " steps ·", " ", data.profiles.find((profile) => profile.id === workflow.profileId)?.name ?? workflow.profileId), /* @__PURE__ */ React.createElement("span", {
      className: "workflow-list-state"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-status-dot",
      "data-enabled": workflow.enabled
    }), workflow.enabled ? "Enabled" : "Disabled")))))), selected || selectedId === "" ? /* @__PURE__ */ React.createElement(Editor, {
      key: `${selected?.id ?? "new"}:${selected?.version ?? 0}`,
      onSaved: saved,
      profiles: data.profiles,
      workflow: selected
    }) : /* @__PURE__ */ React.createElement("section", {
      className: "workflow-welcome"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-welcome-icon"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "workflow"
    })), /* @__PURE__ */ React.createElement("h2", null, data.workflows.length ? "Select a workflow" : "Create your first workflow"), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelectedId(""),
      type: "button"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "Create workflow"))) : /* @__PURE__ */ React.createElement("p", {
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
    const [view, setView] = React.useState("workflow");
    const [selection, setSelection] = React.useState("");
    const [panelTab, setPanelTab] = React.useState("configure");
    const [expanded, setExpanded] = React.useState(false);
    const [tools, setTools] = React.useState([]);
    const [toolsError, setToolsError] = React.useState("");
    const panelRef = React.useRef(null);
    React.useEffect(() => {
      let active = true;
      setTools([]);
      setToolsError("");
      action("tools", { agentId }).then((result) => {
        if (active) {
          setTools(result);
        }
      }).catch((error2) => {
        if (active) {
          setToolsError(String(error2.message ?? error2));
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
      const onKey = (event) => {
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
          setSelection(summary.trim() ? "" : "summary");
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
    const addStep = (database = false) => {
      const step = {
        fields: database ? { input: '{"sql":"","params":[]}', tool: "sqlite" } : { input: '{"url":""}', tool: "web_fetch" },
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
    const title = (id) => id.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return /* @__PURE__ */ React.createElement("section", {
      className: "workflow-editor"
    }, /* @__PURE__ */ React.createElement("form", {
      onSubmit: save
    }, /* @__PURE__ */ React.createElement("fieldset", {
      className: "editor-fields",
      disabled: busy
    }, /* @__PURE__ */ React.createElement("header", {
      className: "editor-toolbar"
    }, /* @__PURE__ */ React.createElement("p", null, name || "New workflow"), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-actions"
    }, (dirty || !workflow) && /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      size: "sm",
      type: "submit"
    }, busy ? "Saving…" : "Save"), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": "Delete workflow",
      disabled: busy || !workflow,
      onClick: () => setConfirmDelete(true),
      size: "icon-sm",
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "delete"
    })), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setSelection("input"),
      size: "sm",
      type: "button",
      variant: "ghost"
    }, "Run input"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || !workflow || dirty || !enabled,
      onClick: runWorkflow,
      size: "sm",
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "play"
    }), busy ? "Running…" : "Test run"))), /* @__PURE__ */ React.createElement("nav", {
      "aria-label": "Workflow views",
      className: "workflow-view-nav"
    }, ["workflow", "runs", "data"].map((tab) => /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": view === tab,
      key: tab,
      onClick: () => {
        setSelection("");
        setView(tab);
      },
      type: "button",
      variant: "ghost"
    }, title(tab)))), error && /* @__PURE__ */ React.createElement(WorkflowError, {
      message: error
    }), view === "runs" && /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Run history",
      className: "workflow-scroll workflow-runs"
    }, !runs.length && /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty"
    }, "No runs yet."), runs.map((run) => /* @__PURE__ */ React.createElement("details", {
      className: "workflow-run-record",
      key: run.id
    }, /* @__PURE__ */ React.createElement("summary", null, /* @__PURE__ */ React.createElement("span", {
      "data-status": run.status
    }, run.status), /* @__PURE__ */ React.createElement("time", {
      dateTime: run.startedAt
    }, new Date(run.startedAt).toLocaleString()), /* @__PURE__ */ React.createElement("span", {
      "aria-label": "Duration",
      className: "workflow-run-duration"
    }, run.completedAt ? `${Math.max(0, (Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000).toFixed(1)}s` : run.status === "running" ? "In progress" : "—")), (run.error || run.output) && /* @__PURE__ */ React.createElement("pre", null, run.error || run.output), (run.steps ?? []).map((step) => /* @__PURE__ */ React.createElement("div", {
      key: step.id
    }, /* @__PURE__ */ React.createElement("h3", null, step.stepId, " · ", step.status), /* @__PURE__ */ React.createElement("pre", null, JSON.stringify({
      error: step.error,
      input: step.input,
      output: step.output
    }, null, 2))))))), view === "data" && /* @__PURE__ */ React.createElement("section", {
      "aria-label": "Workflow data",
      className: "workflow-scroll"
    }, /* @__PURE__ */ React.createElement(DatabasePanel, null)), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-scroll",
      hidden: view !== "workflow"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-content"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-meta"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-meta-row"
    }, /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Workflow name",
      className: "workflow-name",
      maxLength: 200,
      onChange: (event) => setName(event.target.value),
      placeholder: "Untitled workflow",
      required: true,
      value: name
    }), /* @__PURE__ */ React.createElement("label", {
      className: "workflow-enabled"
    }, /* @__PURE__ */ React.createElement(Switch, {
      "aria-label": "Enabled",
      checked: enabled,
      disabled: busy,
      onCheckedChange: setEnabled
    }), "Enabled"), /* @__PURE__ */ React.createElement(Choice, {
      disabled: busy,
      label: "Agent",
      onChange: setAgentId,
      options: profiles.map((profile) => ({
        label: profile.name,
        value: profile.id
      })),
      value: agentId
    })), /* @__PURE__ */ React.createElement(Input, {
      "aria-label": "Workflow description",
      className: "workflow-description",
      onChange: (event) => setDescription(event.target.value),
      placeholder: "Description",
      value: description
    })), /* @__PURE__ */ React.createElement("ol", {
      className: "workflow-steps"
    }, [
      ...steps.map((step) => ({ id: step.id, key: step.key })),
      { id: summaryStep?.id ?? "summary", key: "summary" }
    ].map((step, index) => /* @__PURE__ */ React.createElement("li", {
      key: step.key
    }, /* @__PURE__ */ React.createElement("div", {
      className: "workflow-step-card",
      "data-selected": selection === step.key
    }, /* @__PURE__ */ React.createElement(Button, {
      className: "workflow-step-open",
      onClick: () => setSelection(step.key),
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-step-number"
    }, index + 1), /* @__PURE__ */ React.createElement("span", null, title(step.id) || "Untitled step")), /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, {
      disabled: busy,
      render: /* @__PURE__ */ React.createElement(Button, {
        "aria-label": `Options for ${title(step.id)}`,
        size: "icon-sm",
        type: "button",
        variant: "ghost"
      })
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "more"
    })), /* @__PURE__ */ React.createElement(DropdownMenuContent, {
      align: "end"
    }, /* @__PURE__ */ React.createElement(DropdownMenuItem, {
      onClick: () => setSelection(step.key)
    }, "Configure"), step.key !== "summary" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DropdownMenuItem, {
      disabled: index === 0,
      onClick: () => moveStep(step.key, -1)
    }, "Move earlier"), /* @__PURE__ */ React.createElement(DropdownMenuItem, {
      disabled: index === steps.length - 1,
      onClick: () => moveStep(step.key, 1)
    }, "Move later"), /* @__PURE__ */ React.createElement(DropdownMenuItem, {
      onClick: () => setSteps((current) => current.filter((entry) => entry.key !== step.key)),
      variant: "destructive"
    }, "Delete step"))))), index < steps.length && /* @__PURE__ */ React.createElement("div", {
      "aria-hidden": "true",
      className: "workflow-connector"
    })))), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-add-actions"
    }, /* @__PURE__ */ React.createElement(Button, {
      onClick: () => addStep(),
      size: "sm",
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "Add step"), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => addStep(true),
      size: "sm",
      type: "button",
      variant: "outline"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "add"
    }), "Add database")))))), (selectedStep || selection === "summary") && /* @__PURE__ */ React.createElement("aside", {
      "aria-label": "Workflow step",
      className: "workflow-step-drawer",
      "data-expanded": expanded,
      ref: panelRef,
      tabIndex: -1
    }, /* @__PURE__ */ React.createElement("header", {
      className: "workflow-drawer-header"
    }, /* @__PURE__ */ React.createElement("span", {
      className: "workflow-step-number"
    }, selectedStep ? selectedIndex + 1 : steps.length + 1), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-drawer-title"
    }, /* @__PURE__ */ React.createElement("h2", null, title(selectedStep?.id ?? summaryStep?.id ?? "summary")), /* @__PURE__ */ React.createElement("p", null, selectedStep ? title(selectedStep.fields.tool ?? selectedStep.kind) : "Summarize")), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": expanded ? "Collapse step" : "Expand step",
      onClick: () => setExpanded((value) => !value),
      size: "icon-sm",
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: expanded ? "collapse" : "expand"
    })), /* @__PURE__ */ React.createElement(Button, {
      "aria-label": "Close step",
      onClick: () => setSelection(""),
      size: "icon-sm",
      type: "button",
      variant: "ghost"
    }, /* @__PURE__ */ React.createElement(Icon, {
      kind: "close"
    }))), /* @__PURE__ */ React.createElement("div", {
      "aria-label": "Step views",
      className: "workflow-drawer-tabs"
    }, [
      "configure",
      ...selectedStep?.fields.tool === "sqlite" ? ["database"] : [],
      "test"
    ].map((tab) => /* @__PURE__ */ React.createElement(Button, {
      "aria-pressed": panelTab === tab,
      key: tab,
      onClick: () => setPanelTab(tab),
      type: "button",
      variant: "ghost"
    }, title(tab)))), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-drawer-body"
    }, panelTab === "configure" && /* @__PURE__ */ React.createElement("div", {
      className: "workflow-step-fields"
    }, toolsError && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, toolsError), selectedStep && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", null, "Name", /* @__PURE__ */ React.createElement(Input, {
      disabled: busy,
      onChange: (event) => updateStep(selectedStep.key, {
        id: event.target.value
      }),
      value: selectedStep.id
    })), (stepFields[selectedStep.kind] ?? []).map((field) => field === "tool" ? /* @__PURE__ */ React.createElement("label", {
      key: field
    }, "Tool", /* @__PURE__ */ React.createElement(ToolChoice, {
      disabled: busy,
      onChange: (value) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          tool: value
        }
      }),
      options: Array.from(new Set([
        selectedStep.fields.tool,
        ...tools.map((tool) => tool.name)
      ].filter((name2) => Boolean(name2)))).map((name2) => ({ label: name2, value: name2 })),
      value: selectedStep.fields.tool ?? ""
    })) : field === "op" ? /* @__PURE__ */ React.createElement(Choice, {
      disabled: busy,
      key: field,
      label: "Operator",
      onChange: (value) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          [field]: value
        }
      }),
      options: ["eq", "near", "contains"].map((op) => ({
        label: op,
        value: op
      })),
      value: selectedStep.fields[field] ?? "eq"
    }) : /* @__PURE__ */ React.createElement("label", {
      key: field
    }, field === "input" ? "Input" : title(field), /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      onChange: (event) => updateStep(selectedStep.key, {
        fields: {
          ...selectedStep.fields,
          [field]: event.target.value
        }
      }),
      rows: field === "input" || field === "template" ? 8 : 2,
      value: selectedStep.fields[field] ?? ""
    })))), selection === "summary" && /* @__PURE__ */ React.createElement("label", null, "Summary instructions", /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      onChange: (event) => setSummary(event.target.value),
      rows: 8,
      value: summary
    }))), panelTab === "database" && /* @__PURE__ */ React.createElement(DatabasePanel, null), panelTab === "test" && (() => {
      const receipt = runs[0]?.steps?.find((step) => step.stepId === (selectedStep?.id ?? summaryStep?.id ?? "summary"));
      return receipt ? /* @__PURE__ */ React.createElement("div", {
        className: "workflow-step-fields"
      }, /* @__PURE__ */ React.createElement("p", null, receipt.status), receipt.error && /* @__PURE__ */ React.createElement("p", {
        role: "alert"
      }, receipt.error), /* @__PURE__ */ React.createElement("label", null, "Input", /* @__PURE__ */ React.createElement("pre", null, JSON.stringify(receipt.input, null, 2))), /* @__PURE__ */ React.createElement("label", null, "Output", /* @__PURE__ */ React.createElement("pre", null, JSON.stringify(receipt.output, null, 2)))) : /* @__PURE__ */ React.createElement("p", {
        className: "workflow-empty"
      }, "No test results yet. Run the workflow to see this step’s input and output.");
    })())), /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!(open || busy)) {
          setSelection("");
        }
      },
      open: selection === "input"
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Run input")), /* @__PURE__ */ React.createElement("div", {
      className: "workflow-step-fields",
      style: {
        display: "grid",
        gap: 16,
        maxHeight: "65dvh",
        overflowY: "auto"
      }
    }, selection === "input" && /* @__PURE__ */ React.createElement("label", null, "Run input (JSON)", /* @__PURE__ */ React.createElement(Textarea, {
      disabled: busy,
      onChange: (event) => setRunInput(event.target.value),
      rows: 8,
      spellCheck: false,
      value: runInput
    }))), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setSelection(""),
      type: "button"
    }, "Done")))), /* @__PURE__ */ React.createElement(Dialog, {
      onOpenChange: (open) => {
        if (!busy) {
          setConfirmDelete(open);
        }
      },
      open: confirmDelete
    }, /* @__PURE__ */ React.createElement(DialogContent, null, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, "Delete workflow?"), /* @__PURE__ */ React.createElement(DialogDescription, null, "This removes the workflow and its run history permanently.")), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setConfirmDelete(false),
      type: "button",
      variant: "outline"
    }, "Cancel"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => void perform(async () => {
        await action("delete_workflow", {
          workflowId: workflow.id
        });
        if (mounted.current) {
          await onSaved();
        }
      }),
      type: "button",
      variant: "destructive"
    }, "Delete")))));
  }
  function DatabasePanel() {
    const [table, setTable] = React.useState("");
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      let active = true;
      setLoading(true);
      setError("");
      action("database", table ? { table } : {}).then((result) => {
        if (active) {
          setData(result);
        }
      }).catch((error2) => {
        if (active) {
          setError(error2 instanceof Error ? error2.message : String(error2));
        }
      }).finally(() => {
        if (active) {
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }, [table, retry]);
    return /* @__PURE__ */ React.createElement("div", {
      "aria-busy": loading,
      className: "workflow-step-fields"
    }, error ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), /* @__PURE__ */ React.createElement(Button, {
      onClick: () => setRetry((value) => value + 1),
      type: "button",
      variant: "outline"
    }, "Retry")) : null, Boolean(data?.tables.length) && /* @__PURE__ */ React.createElement(Choice, {
      disabled: loading,
      label: "Table",
      onChange: setTable,
      options: (data?.tables ?? []).map((entry) => ({
        label: entry.name,
        value: entry.name
      })),
      value: table
    }), loading ? /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty",
      role: "status"
    }, "Loading data…") : !error && (data?.tables.length ? table ? data.preview == null ? /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty"
    }, "No preview available.") : /* @__PURE__ */ React.createElement("pre", null, JSON.stringify(data.preview, null, 2)) : /* @__PURE__ */ React.createElement("p", {
      className: "workflow-empty"
    }, "Select a table to preview its data.") : /* @__PURE__ */ React.createElement("div", {
      className: "workflow-empty"
    }, /* @__PURE__ */ React.createElement("p", null, "No tables yet."), /* @__PURE__ */ React.createElement("p", null, "Add a database step and run it to store data here."))));
  }
  ctx.slots.register("tool:run_workflow", WorkflowRunCard);
  ctx.slots.register("page", WorkflowsPage);
}
export {
  apply,
  inject
};
