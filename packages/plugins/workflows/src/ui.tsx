/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import type {
  StoredWorkflow,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowStep,
} from "@nakama/core/contract";
import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
import css from "../ui/style.css" with { type: "text" };
import {
  parseWorkflowValue,
  type WorkflowRecord,
  type WorkflowValue,
} from "./workflow-ops";

type Profile = { id: string; name: string; isDefault?: boolean };

/** The subset of a tool's JSON schema the step form reads. */
type ToolSchema = {
  description?: string;
  enum?: WorkflowValue[];
  properties?: Record<string, ToolSchema>;
  required?: string[];
  title?: string;
  type?: string | string[];
};

type ToolInfo = { description?: string; name: string; parameters?: ToolSchema };

type ValueSource = {
  label: string;
  options: Array<{ label: string; ref: string; sample: string }>;
};

type StepDraft = {
  key: string;
  id: string;
  kind: string;
  fields: Record<string, string>;
};

type WorkflowActionResult = {
  error?: string;
  name?: string;
  run?: WorkflowRunRecord;
};

type ActionResponses = {
  create_workflow: StoredWorkflow;
  database: SavedData;
  delete_workflow: { deleted: boolean };
  get_workflow: StoredWorkflow | null;
  list_workflows: StoredWorkflow[];
  profiles: Profile[];
  run_workflow: WorkflowActionResult;
  test_step: {
    durationMs: number;
    error?: string;
    input?: WorkflowValue;
    output?: WorkflowValue;
  };
  runs: WorkflowRunRecord[];
  tools: ToolInfo[];
  update_workflow: StoredWorkflow;
};

type ToolRenderProps = {
  action: string;
  input?: WorkflowRecord;
  result?: WorkflowActionResult;
  status: "running" | "done";
};

type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  signal: AbortSignal;
  slots: {
    register(slot: "page", component: ReactType.ComponentType): void;
    register(
      slot: `tool:${string}`,
      component: ReactType.ComponentType<ToolRenderProps>
    ): void;
  };
  styles(css: string): void;
  host: {
    call<Action extends keyof ActionResponses>(
      action: Action,
      input?: WorkflowRecord
    ): Promise<ActionResponses[Action]>;
  };
};

export const inject = ["slots", "host", "styles", "ui"];

const stepFields = {
  assert: ["path", "expected"],
  compare: ["left", "op", "right", "tolerance"],
  template: ["template"],
  tool: ["tool", "input"],
} satisfies Record<string, string[]>;

function parseValue(value: string): WorkflowValue {
  try {
    return parseWorkflowValue(JSON.parse(value));
  } catch {
    return value;
  }
}

function readWorkflowString(value: WorkflowValue | undefined): string | null {
  return value === String(value) ? value : null;
}

function isWorkflowRecord(value: WorkflowValue): value is WorkflowRecord {
  return value instanceof Object && !Array.isArray(value);
}

function draftStep(step: WorkflowStep): StepDraft {
  return {
    fields: Object.fromEntries(
      Object.entries(step)
        .filter(([key]) => key !== "id" && key !== "kind")
        .map(([key, value]) => [
          key,
          value === String(value) &&
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

const kindLabels = new Map([
  ["assert", "Check a rule"],
  ["compare", "Compare"],
  ["summarize", "Ask the bot"],
  ["template", "Write a message"],
  ["tool", "Use an app"],
]);

const newStepFields = new Map<string, Record<string, string>>([
  ["assert", { expected: "", path: "" }],
  ["compare", { left: "", op: "eq", right: "" }],
  ["database", { input: '{"sql":"","params":[]}', tool: "sqlite" }],
  ["template", { template: "" }],
  ["tool", { input: '{"url":""}', tool: "web_fetch" }],
]);

function titleCase(id: string) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** `transcript-desk__get_transcript` → app "Transcript Desk", action "Get Transcript". */
function toolParts(name: string) {
  const split = name.lastIndexOf("__");
  const app = split === -1 ? "" : name.slice(0, split);

  return {
    action: titleCase(split === -1 ? name : name.slice(split + 2)),
    app: titleCase(app.replace(/^plugin[_-]+/, "")),
  };
}

function stepApp(kind: string, fields: Record<string, string>) {
  if (kind !== "tool") {
    return kindLabels.get(kind) ?? titleCase(kind);
  }

  if (fields.tool === "sqlite") {
    return "Table";
  }

  const { action, app } = toolParts(fields.tool ?? "");

  return app || action || "Choose an app";
}

type SavedRow = Record<string, WorkflowValue>;

type SavedData = {
  preview?: WorkflowValue;
  tables: Array<{ name: string; rowCount?: number }>;
};

function readPreview(
  value: WorkflowValue | undefined
): { columns: string[]; rows: SavedRow[]; total: number } | null {
  if (!(value && isWorkflowRecord(value))) {
    return null;
  }

  const columns = Array.isArray(value.columns)
    ? value.columns.map((column) => String(column))
    : [];

  const rows = Array.isArray(value.rows)
    ? value.rows.filter((row) => isWorkflowRecord(row))
    : [];

  return {
    columns,
    rows,
    total: value.total === Number(value.total) ? value.total : rows.length,
  };
}

function isUrl(value: WorkflowValue | undefined) {
  return value === String(value) && /^https?:\/\//.test(value);
}

function columnType(rows: SavedRow[], column: string) {
  const values = rows.flatMap((row) => {
    const value = row[column];

    return value == null || value === "" ? [] : [value];
  });

  if (!values.length) {
    return "";
  }

  if (values.every((value) => value === Number(value))) {
    return "number";
  }

  if (values.every((value) => value === true || value === false)) {
    return "boolean";
  }

  if (values.every(isUrl)) {
    return "url";
  }

  if (
    values.every(
      (value) =>
        value === String(value) &&
        /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}|$)/.test(value)
    )
  ) {
    return "datetime";
  }

  return values.every((value) => value === String(value)) ? "text" : "json";
}

function cellText(value: WorkflowValue | undefined, empty = "") {
  if (value == null) {
    return empty;
  }

  return value === String(value) ? value : JSON.stringify(value);
}

function writesTable(sql: string, table: string) {
  const name = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(
    `\\b(insert(\\s+or\\s+\\w+)?\\s+into|replace\\s+into|update)\\s+["'\`[]?${name}\\b`,
    "i"
  ).test(sql);
}

function downloadCsv(table: string, columns: string[], rows: SavedRow[]) {
  const quote = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

  const csv = [
    columns,
    ...rows.map((row) => columns.map((c) => cellText(row[c]))),
  ]
    .map((line) => line.map(quote).join(","))
    .join("\n");

  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `${table}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function uniqueStepId(label: string, taken: string[]) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "step";

  let id = base;

  for (let index = 2; taken.includes(id); index += 1) {
    id = `${base}_${index}`;
  }

  return id;
}

function parseInputRecord(text: string): WorkflowRecord | null {
  try {
    const value = parseWorkflowValue(JSON.parse(text || "{}"));

    return isWorkflowRecord(value) ? value : null;
  } catch {
    return null;
  }
}

const builtInActions = [
  {
    hint: "Keep rows you can read later",
    kind: "database",
    label: "Save to a table",
  },
  {
    hint: "Fill a template with earlier results",
    kind: "template",
    label: "Write a message",
  },
  { hint: "Stop if a value is wrong", kind: "assert", label: "Check a rule" },
  { hint: "Compare two values", kind: "compare", label: "Compare" },
];

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.round(ms / 60_000)}m`;
}

function formatRunTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

/** Error codes such as `invalid_input` read as "Invalid input". */
function readableError(message: string) {
  return /^[a-z]+(?:_[a-z]+)*$/.test(message)
    ? titleCase(message).replace(/ \w/g, (letter) => letter.toLowerCase())
    : message;
}

function relativeTime(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(minutes) < 60) {
    return format.format(minutes, "minute");
  }

  if (Math.abs(minutes) < 60 * 24) {
    return format.format(Math.round(minutes / 60), "hour");
  }

  return format.format(Math.round(minutes / (60 * 24)), "day");
}

function dayGroup(iso: string) {
  const day = new Date(iso).toDateString();

  if (day === new Date().toDateString()) {
    return "Today";
  }

  if (day === new Date(Date.now() - 86_400_000).toDateString()) {
    return "Yesterday";
  }

  return "Earlier";
}

/** Top-level fields of a step value as short label/value rows. */
function readableEntries(value: WorkflowValue): Array<[string, string]> {
  const short = (entry: WorkflowValue): string => {
    if (entry === null || entry === undefined) {
      return "—";
    }

    if (Array.isArray(entry)) {
      return `${entry.length} items`;
    }

    if (isWorkflowRecord(entry)) {
      return `${Object.keys(entry).length} fields`;
    }

    const text = String(entry);

    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  };

  if (value === null || value === undefined) {
    return [];
  }

  if (isWorkflowRecord(value)) {
    return Object.entries(value).map(([key, entry]) => [key, short(entry)]);
  }

  return [["Value", short(value)]];
}

type StepTiming = {
  duration: number | null;
  left: number;
  status: string;
  width: number;
};

/** Where each step sits on the run's timeline, as percentages of the run. */
function runTimeline(run: WorkflowRunRecord | undefined) {
  const timings = new Map<string, StepTiming>();
  const steps = run?.steps ?? [];

  if (!run) {
    return timings;
  }

  const start = Date.parse(run.startedAt);

  const end = Math.max(
    run.completedAt ? Date.parse(run.completedAt) : 0,
    ...steps.map((step) => Date.parse(step.completedAt ?? step.startedAt)),
    start + 1
  );

  for (const step of steps) {
    const from = Date.parse(step.startedAt);
    const to = step.completedAt ? Date.parse(step.completedAt) : null;
    timings.set(step.stepId, {
      duration: to === null ? null : to - from,
      left: ((from - start) / (end - start)) * 100,
      status: step.status,
      width: to === null ? 0 : Math.max(1, ((to - from) / (end - start)) * 100),
    });
  }

  return timings;
}

const stepStatusLabels = new Map([
  ["completed", "Worked"],
  ["failed", "Stopped"],
  ["pending", "Waiting"],
  ["running", "Running"],
  ["skipped", "Skipped"],
]);

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
    Popover,
    PopoverTrigger,
    PopoverContent,
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
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

  function AppBadge({ app }: { app: string }) {
    return (
      <span
        aria-hidden="true"
        className="workflow-app-badge"
        data-tint={app.length % 5}
      >
        {app.charAt(0)}
      </span>
    );
  }

  type ActionChoice = { kind: string; label: string; tool?: string };

  function ActionPicker({
    tools,
    onPick,
  }: {
    tools: ToolInfo[];
    onPick(choice: ActionChoice): void;
  }) {
    const groups = new Map<string, ToolInfo[]>();

    for (const tool of tools) {
      if (tool.name !== "sqlite") {
        const app = toolParts(tool.name).app || "Other";
        groups.set(app, [...(groups.get(app) ?? []), tool]);
      }
    }

    return (
      <Command className="workflow-action-picker">
        <CommandInput
          aria-label="Search actions"
          placeholder="Search apps and actions"
        />
        <CommandList>
          <CommandEmpty>No actions found.</CommandEmpty>
          {[...groups]
            .toSorted(
              ([a], [b]) => Number(a === "Other") - Number(b === "Other")
            )
            .map(([app, entries]) => (
              <CommandGroup
                heading={
                  <span className="workflow-picker-heading">
                    <AppBadge app={app} />
                    {app}
                  </span>
                }
                key={app}
              >
                {entries.map((tool) => {
                  const { action } = toolParts(tool.name);

                  return (
                    <CommandItem
                      key={tool.name}
                      onSelect={() =>
                        onPick({ kind: "tool", label: action, tool: tool.name })
                      }
                      value={`${app} ${action} ${tool.name}`}
                    >
                      <span className="workflow-picker-item">
                        <span>{action}</span>
                        {tool.description && (
                          <span className="workflow-empty">
                            {tool.description.split(/(?<=\.)\s/)[0]}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          <CommandGroup heading="Built in">
            {builtInActions.map((choice) => (
              <CommandItem
                key={choice.kind}
                onSelect={() => onPick(choice)}
                value={`built in ${choice.label}`}
              >
                <span className="workflow-picker-item">
                  <span>{choice.label}</span>
                  <span className="workflow-empty">{choice.hint}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    );
  }

  function ValueField({
    label,
    value,
    sources,
    onChange,
  }: {
    label: string;
    value: string;
    sources: ValueSource[];
    onChange(value: string): void;
  }) {
    const [open, setOpen] = React.useState(false);
    const trimmed = value.trim();
    const isRef = /^\{\{[^{}]+\}\}$/.test(trimmed);

    const refLabel =
      sources
        .flatMap((group) =>
          group.options.map((option) => ({
            label: `${group.label} · ${option.label}`,
            ref: option.ref,
          }))
        )
        .find((option) => option.ref === trimmed)?.label ?? trimmed;

    return (
      <div className="workflow-value-field">
        {isRef ? (
          <span className="workflow-value-chip">
            <span>{refLabel}</span>
            <button
              aria-label={`Clear ${label}`}
              onClick={() => onChange("")}
              type="button"
            >
              <Icon kind="close" />
            </button>
          </span>
        ) : (
          <Input
            aria-label={label}
            onChange={(event) => onChange(event.target.value)}
            value={value}
          />
        )}
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger
            render={<Button size="sm" type="button" variant="ghost" />}
          >
            Use a value
          </PopoverTrigger>
          <PopoverContent align="end" className="overflow-hidden p-0 shadow-sm">
            <Command>
              <CommandInput aria-label="Search values" placeholder="Search" />
              <CommandList>
                <CommandEmpty>
                  Run the workflow once to see values.
                </CommandEmpty>
                {sources.map((group) =>
                  group.options.length ? (
                    <CommandGroup heading={group.label} key={group.label}>
                      {group.options.map((option) => (
                        <CommandItem
                          key={option.ref}
                          onSelect={() => {
                            onChange(option.ref);
                            setOpen(false);
                          }}
                          value={`${group.label} ${option.label}`}
                        >
                          <span className="workflow-picker-item">
                            <span>{option.label}</span>
                            {option.sample && (
                              <span className="workflow-empty">
                                {option.sample}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  function ToolInputFields({
    schema,
    text,
    sources,
    disabled,
    onChange,
  }: {
    schema: ToolSchema | undefined;
    text: string;
    sources: ValueSource[];
    disabled: boolean;
    onChange(text: string): void;
  }) {
    const record = parseInputRecord(text);
    const required = schema?.required ?? [];

    const fields = Object.entries(schema?.properties ?? {}).map(
      ([key, property]) => ({
        key,
        property,
        type: Array.isArray(property.type)
          ? property.type.find((type) => type !== "null")
          : property.type,
      })
    );

    const simple = fields
      .filter((field) => field.type !== "object" && field.type !== "array")
      .toSorted(
        (a, b) =>
          Number(required.includes(b.key)) - Number(required.includes(a.key))
      );

    const setField = (key: string, next: WorkflowValue) =>
      onChange(
        JSON.stringify(
          Object.fromEntries(
            [...Object.entries(record ?? {}), [key, next]].filter(
              ([, entry]) => entry !== "" && entry !== undefined
            )
          ),
          null,
          2
        )
      );

    return (
      <>
        {record === null && (
          <p role="alert">The details below must be a JSON object.</p>
        )}
        {record !== null &&
          simple.map(({ key, property, type }) => {
            const label = property.title ?? titleCase(key);
            const current = record[key];

            return (
              <div className="workflow-field" key={key}>
                <span className="workflow-field-label">
                  {label}
                  {required.includes(key) && (
                    <span aria-label="required" className="workflow-required">
                      *
                    </span>
                  )}
                </span>
                {property.description && (
                  <span className="workflow-field-hint">
                    {property.description}
                  </span>
                )}
                {property.enum ? (
                  <Choice
                    disabled={disabled}
                    label={label}
                    onChange={setField.bind(null, key)}
                    options={property.enum.map((option) => ({
                      label: String(option),
                      value: String(option),
                    }))}
                    value={current === undefined ? "" : String(current)}
                  />
                ) : type === "boolean" ? (
                  <Switch
                    aria-label={label}
                    checked={current === true}
                    disabled={disabled}
                    onCheckedChange={(checked) => setField(key, checked)}
                  />
                ) : (
                  <ValueField
                    label={label}
                    onChange={(next) =>
                      setField(
                        key,
                        (type === "number" || type === "integer") &&
                          /^-?\d+(?:\.\d+)?$/.test(next)
                          ? Number(next)
                          : next
                      )
                    }
                    sources={sources}
                    value={
                      current === undefined || current === null
                        ? ""
                        : isWorkflowRecord(current) || Array.isArray(current)
                          ? JSON.stringify(current)
                          : String(current)
                    }
                  />
                )}
              </div>
            );
          })}
        <details
          className="workflow-technical"
          open={
            record === null || fields.length !== simple.length || !fields.length
          }
        >
          <summary>Edit as JSON</summary>
          <Textarea
            aria-label="Details as JSON"
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            rows={8}
            spellCheck={false}
            value={text}
          />
        </details>
      </>
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
      | "table"
      | "warning"
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
      table: "M3 4h18v16H3V4ZM3 9h18M9 9v11",
      warning: "M12 3 2 21h20L12 3ZM12 9v5M12 17h.01",
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

  function WorkflowError({ message }: { message: string }) {
    const connectionError = /^MCP server "([^"]+)" is not connected\.$/.exec(
      message
    );

    return (
      <div className="workflow-error" role="alert">
        <Icon kind="warning" />
        <p>
          {connectionError ? `${connectionError[1]} isn’t connected.` : message}
        </p>
        {connectionError ? (
          <a href="/system?tab=mcp">Open MCP settings</a>
        ) : null}
      </div>
    );
  }

  const action = <Action extends keyof ActionResponses>(
    name: Action,
    input?: WorkflowRecord
  ): Promise<ActionResponses[Action]> => ctx.host.call(name, input);

  function WorkflowRunCard({ input, result, status }: ToolRenderProps) {
    const workflowId = input && readWorkflowString(input.workflowId);

    const [workflow, setWorkflow] = React.useState<StoredWorkflow | null>(null);

    const [liveRun, setLiveRun] = React.useState<WorkflowRunRecord | null>(
      null
    );

    const record = result ?? null;

    React.useEffect(() => {
      if (!workflowId) {
        return;
      }

      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const load = async () => {
        try {
          const definition = await action("get_workflow", {
            workflowId,
          });

          if (active) {
            setWorkflow(definition);
          }

          if (status === "running") {
            const runs = await action("runs", {
              workflowId,
            });

            if (active) {
              setLiveRun(runs.find((run) => run.status === "running") ?? null);
            }
          }
        } catch {
          // The recorded result remains readable if the workflow was removed.
        }

        if (active && status === "running") {
          timer = setTimeout(load, 1500);
        }
      };

      void load();

      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [workflowId, status]);
    const run = record?.run ?? (status === "running" ? liveRun : null);
    const receipts = run?.steps ?? [];

    const steps =
      workflow?.steps ??
      receipts.map((receipt) => ({ id: receipt.stepId, kind: receipt.kind }));

    const complete = receipts.filter(
      (receipt) => receipt.status === "completed"
    ).length;

    const label =
      run?.status === "failed" || record?.error
        ? "Failed"
        : status === "running"
          ? "Running"
          : run?.status === "completed"
            ? "Done"
            : "Finished";

    return (
      <section aria-label="Workflow run" className="workflow-chat-card">
        <header>
          <h3>{workflow?.name ?? record?.name ?? "Workflow"}</h3>
          <span>
            {label}
            {steps.length ? ` · ${complete} of ${steps.length}` : ""}
          </span>
        </header>
        {run?.error || record?.error ? (
          <p role="alert">{run?.error ?? record?.error}</p>
        ) : null}
        <ol>
          {steps.map((step) => {
            const receipt = receipts.find((item) => item.stepId === step.id);
            const stepStatus = receipt?.status ?? "pending";

            const definition = workflow?.steps.find(
              (item) => item.id === step.id
            );

            const detail =
              definition?.kind === "tool"
                ? definition.tool
                : definition?.kind === "summarize"
                  ? definition.prompt
                  : definition?.kind === "template"
                    ? definition.template
                    : step.kind;

            const output =
              receipt?.output === undefined
                ? undefined
                : parseWorkflowValue(receipt.output);

            const content = isWorkflowRecord(output)
              ? readWorkflowString(output.content)
              : null;

            const meta =
              receipt?.error ??
              (content === null
                ? stepStatus === "completed"
                  ? step.kind === "summarize"
                    ? "Written"
                    : "Done"
                  : stepStatus
                : `${content.trim().split(/\s+/).filter(Boolean).length} words`);

            return (
              <li data-status={stepStatus} key={step.id}>
                <span aria-label={stepStatus} className="workflow-chat-mark">
                  {stepStatus === "completed"
                    ? "✓"
                    : stepStatus === "failed"
                      ? "×"
                      : "○"}
                </span>
                <div>
                  <p>
                    {step.id
                      .replaceAll(/[_-]+/g, " ")
                      .replaceAll(/\b\w/g, (letter) => letter.toUpperCase())}
                  </p>
                  <p className="workflow-chat-detail">{detail}</p>
                </div>
                <span className="workflow-chat-result">{meta}</span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  function WorkflowsPage({
    renderHeaderActions = (children) => children,
  }: {
    renderHeaderActions?: (
      children: ReactType.ReactNode
    ) => ReactType.ReactNode;
  }) {
    const [data, setData] = React.useState<{
      workflows: StoredWorkflow[];
      profiles: Profile[];
    } | null>(null);

    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [error, setError] = React.useState("");

    const [deleteTarget, setDeleteTarget] =
      React.useState<StoredWorkflow | null>(null);

    const [deleting, setDeleting] = React.useState(false);
    React.useEffect(() => {
      let active = true;
      Promise.all([action("list_workflows"), action("profiles")])
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
      const workflows = await action("list_workflows");
      setData((current) => current && { ...current, workflows });
      setSelectedId((current) =>
        current === selectedId ? (id ?? workflows[0]?.id ?? null) : current
      );
    };

    const selected =
      data?.workflows.find((workflow) => workflow.id === selectedId) ?? null;

    const confirmDeleteWorkflow = async () => {
      if (!deleteTarget) {
        return;
      }

      setDeleting(true);

      try {
        await action("delete_workflow", { workflowId: deleteTarget.id });
        const workflows = await action("list_workflows");
        setData((current) => current && { ...current, workflows });
        setSelectedId((current) =>
          current === deleteTarget.id ? (workflows[0]?.id ?? null) : current
        );
        setDeleteTarget(null);
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        setDeleteTarget(null);
      } finally {
        setDeleting(false);
      }
    };

    return (
      <main className="workflows-page">
        {data &&
          renderHeaderActions(
            <Button
              onClick={() => setSelectedId("")}
              type="button"
              variant="outline"
            >
              <Icon kind="add" />
              New workflow
            </Button>
          )}
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
                    <li className="workflow-list-row" key={workflow.id}>
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
                          {workflow.enabled ? "On" : "Off"}
                          {workflow.lastRunAt
                            ? ` · Ran ${relativeTime(workflow.lastRunAt)}`
                            : " · Never run"}
                        </span>
                      </Button>
                      <Button
                        aria-label={`Delete ${workflow.name}`}
                        className="workflow-list-delete"
                        onClick={() => setDeleteTarget(workflow)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Icon kind="delete" />
                      </Button>
                    </li>
                  ))}
                </ul>
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
        <Dialog
          onOpenChange={(open) => {
            if (!(open || deleting)) {
              setDeleteTarget(null);
            }
          }}
          open={deleteTarget !== null}
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
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={deleting}
                onClick={() => void confirmDeleteWorkflow()}
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
    const [view, setView] = React.useState("workflow");
    const [selection, setSelection] = React.useState("");
    const [panelTab, setPanelTab] = React.useState("configure");
    const [expanded, setExpanded] = React.useState(false);
    const [tools, setTools] = React.useState<ToolInfo[]>([]);
    const [picking, setPicking] = React.useState(false);

    const [tried, setTried] = React.useState<{
      key: string;
      result: ActionResponses["test_step"];
    } | null>(null);

    const [toolsError, setToolsError] = React.useState("");
    const panelRef = React.useRef<HTMLElement>(null);
    React.useEffect(() => {
      let active = true;
      setTools([]);
      setToolsError("");
      action("tools", { agentId })
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
      setPicking(false);

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

        if (picking) {
          setPicking(false);
        } else if (expanded) {
          setExpanded(false);
        } else {
          setSelection("");
        }
      };

      window.addEventListener("keydown", onKey);

      return () => window.removeEventListener("keydown", onKey);
    }, [selection, expanded, picking]);
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
        action("runs", { workflowId: workflow.id })
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

        const result = await action(
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

    const pickAction = (choice: ActionChoice) => {
      const fields = choice.tool
        ? { input: "{}", tool: choice.tool }
        : { ...newStepFields.get(choice.kind) };

      const kind = choice.kind === "database" ? "tool" : choice.kind;

      if (picking && selectedStep) {
        updateStep(selectedStep.key, { fields, kind });
        setPicking(false);

        return;
      }

      const step: StepDraft = {
        fields,
        id: uniqueStepId(
          choice.label,
          steps.map((entry) => entry.id)
        ),
        key: crypto.randomUUID(),
        kind,
      };

      setSteps((current) => [...current, step]);
      setSelection(step.key);
    };

    const tryStep = (step: StepDraft) =>
      void perform(async () => {
        const runRecord = parseInputRecord(runInput);

        const request: WorkflowRecord = {
          agentId,
          stepId: step.id,
          steps: parseWorkflowValue([
            ...serializeSteps(steps),
            {
              id: summaryStep?.id ?? "summary",
              kind: "summarize",
              prompt: summary,
            },
          ]),
        };

        // Without run input, the server reuses the last run's input.
        if (runRecord && Object.keys(runRecord).length) {
          request.input = runRecord;
        }

        if (workflow) {
          request.workflowId = workflow.id;
        }

        const result = await action("test_step", request);

        if (mounted.current) {
          setTried({ key: step.key, result });
        }
      });

    const runWorkflow = (previous?: WorkflowRecord | null) =>
      void perform(async () => {
        if (!workflow || dirty || !enabled) {
          return;
        }

        const input: WorkflowValue = previous
          ? parseWorkflowValue(previous)
          : parseWorkflowValue(JSON.parse(runInput || "{}"));

        if (!isWorkflowRecord(input)) {
          throw new Error("Run input must be a JSON object.");
        }

        const result = await action("run_workflow", {
          input,
          workflowId: workflow.id,
        });

        const history = await action("runs", {
          workflowId: workflow.id,
        });

        if (mounted.current) {
          setRuns(history);
        }

        if (result.error) {
          throw new Error(result.error);
        }
      });

    const title = titleCase;
    const lastRun = runs[0];

    const showPicker =
      selection === "pick" || (picking && Boolean(selectedStep));

    const drawerApp = selectedStep
      ? stepApp(selectedStep.kind, selectedStep.fields)
      : (profiles.find((profile) => profile.id === agentId)?.name ?? "Bot");

    const valueSources: ValueSource[] = [
      {
        label: "Run input",
        options: readableEntries(parseInputRecord(runInput) ?? {}).map(
          ([key, sample]) => ({
            label: titleCase(key),
            ref: `{{input.${key}}}`,
            sample,
          })
        ),
      },
      ...steps.slice(0, Math.max(selectedIndex, 0)).map((step, index) => {
        const receipt = lastRun?.steps?.find(
          (entry) => entry.stepId === step.id
        );

        const output =
          receipt?.output == null
            ? undefined
            : parseWorkflowValue(receipt.output);

        const fieldsOut = isWorkflowRecord(output)
          ? readableEntries(output)
          : [];

        return {
          label: `Step ${index + 1} · ${titleCase(step.id)}`,
          options: [
            ...fieldsOut.map(([key, sample]) => ({
              label: titleCase(key),
              ref: `{{steps.${step.id}.${key}}}`,
              sample,
            })),
            {
              label: "Whole result",
              ref: `{{steps.${step.id}}}`,
              sample: fieldsOut.length
                ? ""
                : (readableEntries(output)[0]?.[1] ?? ""),
            },
          ],
        };
      }),
    ];

    const lastTimeline = runTimeline(lastRun);
    const failedInARow = runs.findIndex((run) => run.status !== "failed");
    const needsLook = failedInARow === -1 ? runs.length : failedInARow;

    const tableWriters = steps
      .filter((step) => step.fields.tool === "sqlite")
      .map((step) => ({ name: title(step.id), sql: step.fields.input ?? "" }));

    const allSteps = [
      ...steps.map((step) => ({
        app: stepApp(step.kind, step.fields),
        id: step.id,
        key: step.key,
        kind: step.kind,
      })),
      {
        app: profiles.find((profile) => profile.id === agentId)?.name ?? "Bot",
        id: summaryStep?.id ?? "summary",
        key: "summary",
        kind: "summarize",
      },
    ];

    return (
      <section className="workflow-editor">
        <form onSubmit={save}>
          <fieldset className="editor-fields" disabled={busy}>
            <header className="editor-toolbar">
              <div className="workflow-title-row">
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
                    aria-label="On"
                    checked={enabled}
                    disabled={busy}
                    onCheckedChange={setEnabled}
                  />
                  On
                </label>
              </div>
              <div className="workflow-actions">
                {(dirty || !workflow) && (
                  <Button disabled={busy} size="sm" type="submit">
                    {busy ? "Saving…" : "Save"}
                  </Button>
                )}
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy}
                    render={
                      <Button
                        aria-label="More actions"
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      />
                    }
                  >
                    <Icon kind="more" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSelection("input")}>
                      Run input
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!workflow}
                      onClick={() => setConfirmDelete(true)}
                      variant="destructive"
                    >
                      Delete workflow
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  disabled={busy || !workflow || dirty || !enabled}
                  onClick={() => runWorkflow()}
                  size="sm"
                  type="button"
                >
                  <Icon kind="play" />
                  {busy ? "Running…" : "Try it"}
                </Button>
              </div>
            </header>
            <nav aria-label="Workflow views" className="workflow-view-nav">
              {[
                ["workflow", "Steps"],
                ["runs", "History"],
                ["data", "Saved data"],
              ].map(([tab, label]) => (
                <Button
                  aria-pressed={view === tab}
                  key={tab}
                  onClick={() => {
                    setSelection("");
                    setView(tab!);
                  }}
                  type="button"
                  variant="ghost"
                >
                  {label}
                  {tab === "runs" && needsLook > 0 && (
                    <span
                      aria-label={`${needsLook} failed`}
                      className="workflow-tab-badge"
                    >
                      {needsLook}
                    </span>
                  )}
                </Button>
              ))}
            </nav>
            {error && <WorkflowError message={error} />}
            {view === "runs" && (
              <RunHistory
                canRun={Boolean(workflow) && !dirty && enabled && !busy}
                onRunAgain={(input) => runWorkflow(input)}
                runs={runs}
                stepNames={Object.fromEntries(
                  allSteps.map((step) => [step.id, title(step.id)])
                )}
              />
            )}
            {view === "data" && (
              <section
                aria-label="Workflow data"
                className="workflow-data-page"
              >
                <DatabasePanel
                  canRun={Boolean(workflow) && !dirty && enabled && !busy}
                  onRun={() => runWorkflow()}
                  writers={tableWriters}
                />
              </section>
            )}
            <div className="workflow-scroll" hidden={view !== "workflow"}>
              <div className="workflow-content">
                <Textarea
                  aria-label="Workflow description"
                  className="workflow-description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Description"
                  rows={1}
                  value={description}
                />
                <ol className="workflow-steps">
                  {allSteps.map((step, index) => {
                    const timing = lastTimeline.get(step.id);

                    return (
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
                            <AppBadge app={step.app} />
                            <span className="workflow-step-text">
                              <span className="workflow-step-kind">
                                {step.key === "summary"
                                  ? "Summary"
                                  : `Step ${index + 1}`}{" "}
                                · {step.app}
                              </span>
                              <span className="workflow-step-name">
                                {title(step.id) || "Untitled step"}
                              </span>
                            </span>
                            {timing && (
                              <span
                                className="workflow-step-last"
                                data-status={timing.status}
                              >
                                <span>
                                  {timing.status === "completed" && "✓ "}
                                  {stepStatusLabels.get(timing.status) ??
                                    timing.status}
                                  {timing.duration !== null &&
                                    ` · ${formatDuration(timing.duration)}`}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="workflow-bar"
                                >
                                  <span
                                    style={{
                                      left: `${timing.left}%`,
                                      width: `${timing.width}%`,
                                    }}
                                  />
                                </span>
                              </span>
                            )}
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
                    );
                  })}
                </ol>
                <div className="workflow-add-actions">
                  <Button
                    onClick={() => setSelection("pick")}
                    type="button"
                    variant="outline"
                  >
                    <Icon kind="add" />
                    Add step
                  </Button>
                </div>
              </div>
            </div>
          </fieldset>
        </form>
        {(selectedStep || selection === "summary" || selection === "pick") && (
          <aside
            aria-label="Workflow step"
            className="workflow-step-drawer"
            data-expanded={expanded}
            ref={panelRef}
            tabIndex={-1}
          >
            <header className="workflow-drawer-header">
              {showPicker ? (
                <div className="workflow-drawer-title">
                  <p>
                    Step {selectedStep ? selectedIndex + 1 : steps.length + 1}
                  </p>
                  <h2>What should this step do?</h2>
                </div>
              ) : (
                <>
                  <AppBadge app={drawerApp} />
                  <div className="workflow-drawer-title">
                    <p>
                      {selectedStep ? `Step ${selectedIndex + 1}` : "Summary"} ·{" "}
                      {drawerApp}
                    </p>
                    <h2>
                      {title(selectedStep?.id ?? summaryStep?.id ?? "summary")}
                    </h2>
                  </div>
                </>
              )}
              <Button
                aria-label={expanded ? "Collapse step" : "Expand step"}
                onClick={() => setExpanded((value) => !value)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icon kind={expanded ? "collapse" : "expand"} />
              </Button>
              <Button
                aria-label="Close step"
                onClick={() => setSelection("")}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icon kind="close" />
              </Button>
            </header>
            {showPicker ? (
              <div className="workflow-drawer-body">
                <ActionPicker onPick={pickAction} tools={tools} />
              </div>
            ) : (
              <>
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
                      {{
                        configure: "Settings",
                        database: "Data",
                        test: "Last run",
                      }[tab] ?? title(tab)}
                    </Button>
                  ))}
                </div>
                <div className="workflow-drawer-body">
                  {panelTab === "configure" && (
                    <div className="workflow-step-fields">
                      {toolsError && <p role="alert">{toolsError}</p>}
                      {selectedStep && (
                        <>
                          <label>
                            Step name
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
                              <div className="workflow-field" key={field}>
                                <span className="workflow-field-label">
                                  Action
                                </span>
                                <Button
                                  className="workflow-action-button"
                                  disabled={busy}
                                  onClick={() => setPicking(true)}
                                  type="button"
                                  variant="outline"
                                >
                                  <AppBadge app={drawerApp} />
                                  <span>
                                    {selectedStep.fields.tool === "sqlite"
                                      ? "Save to a table"
                                      : toolParts(
                                          selectedStep.fields.tool ?? ""
                                        ).action}
                                  </span>
                                  <span className="workflow-empty">Change</span>
                                </Button>
                              </div>
                            ) : field === "input" &&
                              selectedStep.fields.tool !== "sqlite" ? (
                              <ToolInputFields
                                disabled={busy}
                                key={field}
                                onChange={(text) =>
                                  updateStep(selectedStep.key, {
                                    fields: {
                                      ...selectedStep.fields,
                                      input: text,
                                    },
                                  })
                                }
                                schema={
                                  tools.find(
                                    (tool) =>
                                      tool.name === selectedStep.fields.tool
                                  )?.parameters
                                }
                                sources={valueSources}
                                text={selectedStep.fields.input ?? ""}
                              />
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
                                options={["eq", "near", "contains"].map(
                                  (op) => ({
                                    label: op,
                                    value: op,
                                  })
                                )}
                                value={selectedStep.fields[field] ?? "eq"}
                              />
                            ) : (
                              <label key={field}>
                                {field === "input" ? "Details" : title(field)}
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
                          What should the bot write?
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
                  {panelTab === "database" && (
                    <DatabasePanel
                      canRun={Boolean(workflow) && !dirty && enabled && !busy}
                      onRun={() => runWorkflow()}
                      writers={tableWriters}
                    />
                  )}
                  {panelTab === "test" &&
                    (() => {
                      const receipt = runs[0]?.steps?.find(
                        (step) =>
                          step.stepId ===
                          (selectedStep?.id ?? summaryStep?.id ?? "summary")
                      );

                      const attempt =
                        selectedStep && tried?.key === selectedStep.key
                          ? tried.result
                          : null;

                      return (
                        <div className="workflow-step-fields">
                          {selectedStep && (
                            <section className="workflow-try">
                              <Button
                                disabled={busy}
                                onClick={() => tryStep(selectedStep)}
                                type="button"
                                variant="outline"
                              >
                                <Icon kind="play" />
                                {busy ? "Trying…" : "Try this step"}
                              </Button>
                              {attempt && (
                                <>
                                  <p
                                    className="workflow-try-status"
                                    data-status={
                                      attempt.error ? "failed" : "completed"
                                    }
                                  >
                                    {attempt.error ? "Stopped" : "Worked"} in{" "}
                                    {formatDuration(attempt.durationMs)}
                                  </p>
                                  <StepReceipt
                                    receipt={{
                                      error: attempt.error
                                        ? readableError(attempt.error)
                                        : null,
                                      input: attempt.input,
                                      output: attempt.output,
                                    }}
                                  />
                                </>
                              )}
                            </section>
                          )}
                          {receipt ? (
                            <section>
                              <h3 className="workflow-try-heading">Last run</h3>
                              <StepReceipt receipt={receipt} />
                            </section>
                          ) : (
                            !attempt && (
                              <p className="workflow-empty">
                                No results yet. Try this step or run the
                                workflow.
                              </p>
                            )
                          )}
                        </div>
                      );
                    })()}
                </div>
              </>
            )}
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

  function StepReceipt({
    receipt,
    showError = true,
  }: {
    receipt: Pick<WorkflowRunStepRecord, "error" | "input" | "output">;
    showError?: boolean;
  }) {
    const sections = [
      ["What went in", receipt.input],
      ["What came out", receipt.output],
    ].map(([label, value]) => ({
      entries: readableEntries(
        value == null ? undefined : parseWorkflowValue(value)
      ),
      label: String(label),
    }));

    const recorded = sections.some((section) => section.entries.length);

    return (
      <>
        {showError && receipt.error && (
          <p role="alert">{readableError(receipt.error)}</p>
        )}
        {recorded ? (
          <div className="workflow-receipt">
            {sections.map(({ entries, label }) => (
              <section key={label}>
                <h4>{label}</h4>
                {entries.length ? (
                  <dl>
                    {entries.map(([key, entry]) => (
                      <div key={key}>
                        <dt>{titleCase(key)}</dt>
                        <dd title={entry}>{entry}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="workflow-empty">Nothing</p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <p className="workflow-empty">No data was saved for this step.</p>
        )}
        <details className="workflow-technical">
          <summary>Technical details</summary>
          <pre>
            {JSON.stringify(
              {
                error: receipt.error,
                input: receipt.input,
                output: receipt.output,
              },
              null,
              2
            )}
          </pre>
        </details>
      </>
    );
  }

  function RunHistory({
    runs,
    stepNames,
    canRun,
    onRunAgain,
  }: {
    runs: WorkflowRunRecord[];
    stepNames: Record<string, string>;
    canRun: boolean;
    onRunAgain(input: WorkflowRecord | null): void;
  }) {
    const [selectedId, setSelectedId] = React.useState("");
    const run = runs.find((entry) => entry.id === selectedId) ?? runs[0];

    if (!run) {
      return (
        <section aria-label="History" className="workflow-scroll">
          <p className="workflow-empty">No runs yet.</p>
        </section>
      );
    }

    const receipts = run.steps ?? [];
    const timeline = runTimeline(run);
    const failedIndex = receipts.findIndex((step) => step.status === "failed");
    const name = (stepId: string) => stepNames[stepId] ?? titleCase(stepId);

    return (
      <div className="workflow-history">
        <nav aria-label="Past runs" className="workflow-history-list">
          {["Today", "Yesterday", "Earlier"].map((group) => {
            const entries = runs.filter(
              (entry) => dayGroup(entry.startedAt) === group
            );

            return entries.length ? (
              <section key={group}>
                <h3>{group}</h3>
                {entries.map((entry) => (
                  <Button
                    aria-current={entry.id === run.id ? "true" : undefined}
                    className="workflow-history-item"
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span
                      aria-hidden="true"
                      className="workflow-run-badge"
                      data-status={entry.status}
                    >
                      {entry.status === "completed"
                        ? "✓"
                        : entry.status === "failed"
                          ? "!"
                          : "…"}
                    </span>
                    <span className="workflow-history-text">
                      <span>
                        {group === "Earlier"
                          ? formatRunTime(entry.startedAt)
                          : new Date(entry.startedAt).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" }
                            )}
                      </span>
                      <span className="workflow-empty">
                        {stepStatusLabels.get(entry.status) ?? entry.status}
                      </span>
                    </span>
                  </Button>
                ))}
              </section>
            ) : null;
          })}
        </nav>
        <section aria-label="Run details" className="workflow-history-detail">
          <header>
            <div>
              <span className="workflow-run-chip" data-status={run.status}>
                {run.status === "failed"
                  ? "Needs a look"
                  : (stepStatusLabels.get(run.status) ?? run.status)}
              </span>
              <h3>
                {run.status === "failed"
                  ? `Stopped at step ${failedIndex + 1}`
                  : run.status === "running"
                    ? "Running…"
                    : `All ${receipts.length} steps worked`}
              </h3>
              <p className="workflow-empty">
                {formatRunTime(run.startedAt)}
                {run.completedAt &&
                  ` · took ${formatDuration(Date.parse(run.completedAt) - Date.parse(run.startedAt))}`}
              </p>
            </div>
            <Button
              disabled={!canRun}
              onClick={() => onRunAgain(run.input)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Icon kind="play" />
              Run again
            </Button>
          </header>
          {run.error && (
            <div className="workflow-history-error" role="alert">
              <Icon kind="warning" />
              <div>
                <p>
                  {failedIndex >= 0
                    ? `${name(receipts[failedIndex]!.stepId)} did not finish`
                    : "This run did not finish"}
                </p>
                <p>{readableError(run.error)}</p>
              </div>
            </div>
          )}
          <div className="workflow-trace-box">
            <div aria-hidden="true" className="workflow-trace-head">
              <span />
              <span>Step</span>
              <span>When it ran</span>
              <span>Time</span>
            </div>
            <ol className="workflow-trace">
              {receipts.map((receipt) => {
                const timing = timeline.get(receipt.stepId);

                return (
                  <li data-status={receipt.status} key={receipt.id}>
                    <details open={receipt.status === "failed"}>
                      <summary>
                        <span
                          className="workflow-run-mark"
                          data-status={receipt.status}
                        />
                        <span className="workflow-trace-name">
                          {name(receipt.stepId)}
                          <span className="workflow-empty">
                            {stepStatusLabels.get(receipt.status) ??
                              receipt.status}
                          </span>
                        </span>
                        <span aria-hidden="true" className="workflow-bar">
                          <span
                            style={{
                              left: `${timing?.left ?? 0}%`,
                              width: `${timing?.width ?? 0}%`,
                            }}
                          />
                        </span>
                        <span className="workflow-trace-time">
                          {timing?.duration == null
                            ? "—"
                            : formatDuration(timing.duration)}
                        </span>
                      </summary>
                      <div className="workflow-trace-body">
                        <StepReceipt receipt={receipt} showError={false} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          </div>
          {run.status === "completed" && run.output && (
            <section className="workflow-history-result">
              <h4>Result</h4>
              <p>{run.output}</p>
            </section>
          )}
        </section>
      </div>
    );
  }

  function DatabasePanel({
    canRun,
    onRun,
    writers,
  }: {
    canRun: boolean;
    onRun: () => void;
    writers: Array<{ name: string; sql: string }>;
  }) {
    const [table, setTable] = React.useState("");
    const [view, setView] = React.useState<"rows" | "schema" | "json">("rows");
    const [query, setQuery] = React.useState("");
    const [picked, setPicked] = React.useState<number | null>(null);
    const [data, setData] = React.useState<SavedData | null>(null);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [retry, setRetry] = React.useState(0);

    React.useEffect(() => {
      let active = true;
      setLoading(true);
      setError("");
      action("database", table ? { table } : {})
        .then((result) => {
          if (!active) {
            return;
          }

          setData(result);

          if (!table && result.tables[0]) {
            setTable(result.tables[0].name);
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

    const pickTable = (name: string) => {
      setTable(name);
      setQuery("");
      setPicked(null);
    };

    const preview = readPreview(data?.preview);
    const columns = preview?.columns ?? [];
    const rows = preview?.rows ?? [];

    const types = Object.fromEntries(
      columns.map((column) => [column, columnType(rows, column)])
    );

    const needle = query.trim().toLowerCase();

    const shown = rows.flatMap((row, index) =>
      !needle ||
      Object.values(row).some((value) =>
        cellText(value).toLowerCase().includes(needle)
      )
        ? [{ index, row }]
        : []
    );

    const selected = picked == null ? null : (rows[picked] ?? null);
    const keyColumn = columns.find((column) => column === "id") ?? columns[0];
    const writer = writers.find((entry) => writesTable(entry.sql, table));
    const total = preview?.total ?? 0;

    if (error) {
      return (
        <div className="workflow-data-message">
          <p role="alert">{error}</p>
          <Button
            onClick={() => setRetry((value) => value + 1)}
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      );
    }

    if (!data && loading) {
      return (
        <p className="workflow-data-message workflow-empty" role="status">
          Loading data…
        </p>
      );
    }

    if (!data?.tables.length) {
      return (
        <div className="workflow-data-message workflow-empty">
          <p>No tables yet.</p>
          <p>Add a database step and run it to store data here.</p>
        </div>
      );
    }

    return (
      <div aria-busy={loading} className="workflow-data">
        <nav aria-label="Tables" className="workflow-data-tables">
          <p>Tables</p>
          {data.tables.map((entry) => (
            <Button
              aria-current={entry.name === table ? "true" : undefined}
              key={entry.name}
              onClick={() => pickTable(entry.name)}
              type="button"
              variant="ghost"
            >
              <Icon kind="table" />
              <span className="workflow-data-table-name">{entry.name}</span>
              <span className="workflow-data-count">
                {entry.rowCount ?? ""}
              </span>
            </Button>
          ))}
        </nav>
        <div className="workflow-data-main">
          <header className="workflow-data-head">
            <h2>{table}</h2>
            <span className="workflow-empty">
              {total} {total === 1 ? "row" : "rows"} · {columns.length} columns
              {rows.length < total ? ` · showing first ${rows.length}` : ""}
            </span>
            <div
              aria-label="Table view"
              className="workflow-data-views"
              role="tablist"
            >
              {(
                [
                  ["rows", "Rows"],
                  ["schema", "Schema"],
                  ["json", "JSON"],
                ] as const
              ).map(([id, label]) => (
                <Button
                  aria-selected={view === id}
                  key={id}
                  onClick={() => setView(id)}
                  role="tab"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {label}
                </Button>
              ))}
            </div>
          </header>

          {view === "rows" && (
            <>
              <div className="workflow-data-toolbar">
                <Input
                  aria-label="Search rows"
                  disabled={!rows.length}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search rows"
                  type="search"
                  value={query}
                />
                <Button
                  disabled={!rows.length}
                  onClick={() => downloadCsv(table, columns, rows)}
                  type="button"
                  variant="outline"
                >
                  Export CSV
                </Button>
              </div>
              <div className="workflow-data-body">
                <div className="workflow-data-grid">
                  <div className="workflow-data-scroll">
                    <table>
                      <thead>
                        <tr>
                          {columns.map((column) => (
                            <th key={column} scope="col">
                              {column}
                              <span>{types[column]}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map(({ index, row }) => (
                          <tr
                            aria-selected={picked === index}
                            key={index}
                            onClick={() => setPicked(index)}
                          >
                            {columns.map((column, at) => (
                              <td data-type={types[column]} key={column}>
                                {at === 0 ? (
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPicked(index);
                                    }}
                                    type="button"
                                  >
                                    {cellText(row[column])}
                                  </button>
                                ) : (
                                  cellText(row[column])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!rows.length && (
                    <div className="workflow-data-empty">
                      <Icon kind="table" />
                      <h3>No rows yet</h3>
                      <p>
                        {writer
                          ? `${writer.name} writes to this table. Run the workflow to fill it.`
                          : "Run the workflow to fill this table."}
                      </p>
                      <Button disabled={!canRun} onClick={onRun} type="button">
                        <Icon kind="play" />
                        Try it now
                      </Button>
                    </div>
                  )}
                  {Boolean(rows.length) && !shown.length && (
                    <p className="workflow-data-empty workflow-empty">
                      No rows match your search.
                    </p>
                  )}
                </div>
                {selected && (
                  <aside aria-label="Row details" className="workflow-data-row">
                    <header>
                      <h3>Row</h3>
                      {keyColumn && (
                        <span>
                          {keyColumn} = {cellText(selected[keyColumn])}
                        </span>
                      )}
                      <Button
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            JSON.stringify(selected, null, 2)
                          )
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Copy JSON
                      </Button>
                      <Button
                        aria-label="Close row details"
                        onClick={() => setPicked(null)}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <Icon kind="close" />
                      </Button>
                    </header>
                    <dl>
                      {columns.map((column) => (
                        <div key={column}>
                          <dt>
                            <span>{column}</span>
                            <span>{types[column]}</span>
                          </dt>
                          <dd
                            data-empty={selected[column] == null || undefined}
                            data-type={types[column]}
                          >
                            {types[column] === "url" &&
                            isUrl(selected[column]) ? (
                              <a
                                href={String(selected[column])}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {String(selected[column])}
                              </a>
                            ) : (
                              cellText(selected[column], "null")
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {writer && (
                      <p className="workflow-data-writer">
                        Written by {writer.name}
                      </p>
                    )}
                  </aside>
                )}
              </div>
            </>
          )}

          {view === "schema" && (
            <div className="workflow-data-grid">
              <div className="workflow-data-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Column</th>
                      <th scope="col">Type</th>
                      <th scope="col">Written by</th>
                      <th scope="col">Last value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((column) => (
                      <tr key={column}>
                        <td data-type="key">{column}</td>
                        <td>
                          <span className="workflow-data-type">
                            {types[column] || "unknown"}
                          </span>
                        </td>
                        <td>{writer?.name ?? "—"}</td>
                        <td data-type="muted">
                          {rows.length ? cellText(rows[0]?.[column]) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "json" && (
            <pre className="workflow-data-json">
              {JSON.stringify(data.preview ?? null, null, 2)}
            </pre>
          )}
        </div>
      </div>
    );
  }

  ctx.slots.register("tool:run_workflow", WorkflowRunCard);
  ctx.slots.register("page", WorkflowsPage);
}
