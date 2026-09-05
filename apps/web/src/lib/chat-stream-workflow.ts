import type {
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowRunStepStatus,
  WorkflowStep,
} from "@nakama/core/contract";
import { formatSessionRelativeTime } from "@/lib/chat-history";

export function isRunWorkflowTool(tool: string | undefined): boolean {
  return tool === "run_workflow";
}

export function isListWorkflowsTool(tool: string | undefined): boolean {
  return tool === "list_workflows";
}

export interface ListedWorkflow {
  description: string;
  enabled: boolean;
  id: string;
  lastRunAt: string | null;
  name: string;
  stepCount: number | null;
}

export function parseListWorkflowsResult(result: unknown): ListedWorkflow[] {
  if (!Array.isArray(result)) {
    return [];
  }

  return result.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const name = readTrimmedString(record.name);
    const id = readTrimmedString(record.id);
    if (!(name && id)) {
      return [];
    }

    return [
      {
        description: readTrimmedString(record.description) ?? "",
        enabled: record.enabled !== false,
        id,
        lastRunAt: readTrimmedString(record.lastRunAt),
        name,
        stepCount:
          typeof record.stepCount === "number" ? record.stepCount : null,
      },
    ];
  });
}

export function formatListWorkflowsToolResult(result: unknown): string | null {
  if (!Array.isArray(result)) {
    return null;
  }

  const workflows = parseListWorkflowsResult(result);
  if (workflows.length === 0) {
    return "None";
  }

  return workflows
    .map((workflow) => {
      const meta = listedWorkflowMeta(workflow.stepCount, workflow.lastRunAt);
      const off = workflow.enabled ? "" : " · Off";
      return meta
        ? `${workflow.name}${off} · ${meta}`
        : `${workflow.name}${off}`;
    })
    .join("\n");
}

function listedWorkflowMeta(
  stepCount: number | null,
  lastRunAt: string | null
): string {
  const steps =
    stepCount == null
      ? null
      : stepCount === 1
        ? "1 step"
        : `${stepCount} steps`;
  const when = lastRunAt ? formatSessionRelativeTime(lastRunAt) : null;
  return [steps, when].filter(Boolean).join(" · ");
}

export function parseWorkflowId(
  input?: Record<string, unknown>
): string | null {
  const value = input?.workflowId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseRunWorkflowResult(result: unknown): {
  name: string | null;
  run: WorkflowRunRecord | null;
  status: "completed" | "failed" | null;
} | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const record = result as Record<string, unknown>;
  const status =
    record.status === "completed" || record.status === "failed"
      ? record.status
      : null;
  const run = isWorkflowRunRecord(record.run) ? record.run : null;

  return {
    name: readTrimmedString(record.name),
    run,
    status,
  };
}

export function pickRunningWorkflowRun(
  runs: WorkflowRunRecord[]
): WorkflowRunRecord | null {
  return runs.find((run) => run.status === "running") ?? null;
}

export function formatWorkflowRunStatusLabel(
  status: "running" | "completed" | "failed" | "off",
  isRunning: boolean,
  activeIndex: number,
  total: number
): string {
  if (status === "failed") {
    return total ? `Failed · step ${activeIndex + 1} of ${total}` : "Failed";
  }

  if (status === "off") {
    return "Off";
  }

  if (status === "running" || isRunning) {
    return total ? `Running · step ${activeIndex + 1} of ${total}` : "Running";
  }

  return total ? `Done · ${total} of ${total}` : "Done";
}

export interface WorkflowStepView {
  detail: string;
  id: string;
  kind: WorkflowStep["kind"];
  meta: string | null;
  status: WorkflowRunStepStatus;
  tag: string | null;
  title: string;
  tool: string | null;
}

export function buildWorkflowStepViews(
  steps: WorkflowStep[],
  run: WorkflowRunRecord | null
): WorkflowStepView[] {
  const receipts = new Map(
    (run?.steps ?? []).map((step) => [step.stepId, step])
  );

  const views =
    steps.length > 0
      ? steps.map((step) => {
          const receipt = receipts.get(step.id);
          return {
            detail: describeWorkflowStep(step),
            id: step.id,
            kind: step.kind,
            meta: formatWorkflowStepMeta(step.kind, receipt),
            status: receipt?.status ?? "pending",
            tag: step.kind === "tool" ? firstStringValue(step.input) : null,
            title: humanizeWorkflowStepId(step.id),
            tool: step.kind === "tool" ? step.tool : null,
          };
        })
      : (run?.steps ?? []).map((receipt) => ({
          detail: receipt.kind,
          id: receipt.stepId,
          kind: receipt.kind,
          meta: formatWorkflowStepMeta(receipt.kind, receipt),
          status: receipt.status,
          tag: null,
          title: humanizeWorkflowStepId(receipt.stepId),
          tool: null,
        }));

  return markLivePendingStepRunning(views, run?.status === "running");
}

function markLivePendingStepRunning(
  views: WorkflowStepView[],
  runIsLive: boolean
): WorkflowStepView[] {
  if (!runIsLive || views.some((step) => step.status === "running")) {
    return views;
  }

  const pendingIndex = views.findIndex((step) => step.status === "pending");
  if (pendingIndex < 0) {
    return views;
  }

  return views.map((step, index) =>
    index === pendingIndex ? { ...step, status: "running" } : step
  );
}

export function activeWorkflowStepIndex(views: WorkflowStepView[]): number {
  const running = views.findIndex((step) => step.status === "running");
  if (running >= 0) {
    return running;
  }

  const failed = views.findIndex((step) => step.status === "failed");
  if (failed >= 0) {
    return failed;
  }

  const pending = views.findIndex((step) => step.status === "pending");
  if (pending >= 0) {
    return pending;
  }

  return Math.max(0, views.length - 1);
}

export function describeWorkflowStep(step: WorkflowStep): string {
  if (step.kind === "tool") {
    return step.tool === "web_fetch"
      ? "Web Fetch"
      : step.tool === "web_search"
        ? "Web Search"
        : step.tool;
  }

  if (step.kind === "compare") {
    return `${compactValue(step.left)} ${step.op} ${compactValue(step.right)}`;
  }

  if (step.kind === "assert") {
    return step.path;
  }

  if (step.kind === "template") {
    return truncateDisplay(step.template, 72);
  }

  return truncateDisplay(step.prompt, 72);
}

export function humanizeWorkflowStepId(id: string): string {
  return id
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWorkflowStepMeta(
  kind: WorkflowStep["kind"],
  receipt: WorkflowRunStepRecord | undefined
): string | null {
  if (!receipt) {
    return null;
  }

  if (receipt.error?.trim()) {
    return truncateDisplay(receipt.error, 48);
  }

  return summarizeReceiptOutput(kind, receipt.output);
}

function summarizeReceiptOutput(
  kind: WorkflowStep["kind"],
  output: unknown
): string | null {
  if (output == null) {
    return kind === "summarize" ? "Written" : "Done";
  }

  if (typeof output === "string") {
    const heading = output.match(/^#+\s+(.+)$/m);
    if (heading?.[1]) {
      return truncateDisplay(heading[1].replaceAll(/[*_`]/g, ""), 40);
    }

    return kind === "summarize" ? "Written" : truncateDisplay(output, 40);
  }

  if (typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }

  if (typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    if (typeof record.bytes === "number") {
      return `${Math.round(record.bytes / 1024)} KB`;
    }

    if (typeof record.output === "string" && record.output.trim()) {
      return summarizeReceiptOutput(kind, record.output);
    }

    if (record.ok === true) {
      return "ok";
    }

    if ("content" in record) {
      return "Fetched";
    }
  }

  return kind === "summarize" ? "Written" : "Done";
}

function isWorkflowRunRecord(value: unknown): value is WorkflowRunRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.workflowId === "string" &&
    typeof record.status === "string"
  );
}

function firstStringValue(input: Record<string, unknown>): string | null {
  for (const key of ["url", "query", "path", "command"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return key === "url"
        ? formatHost(value.trim())
        : truncateDisplay(value.trim(), 32);
    }
  }

  return null;
}

function compactValue(value: unknown): string | null {
  if (typeof value === "string") {
    return truncateDisplay(value, 48);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function formatHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return truncateDisplay(value, 32);
  }
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateDisplay(value: string, maxLength: number): string {
  const trimmed = value.trim().replaceAll(/\s+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}
