export const DEFAULT_SUB_AGENT_TIMEOUT_MS = 300_000;
export const MAX_SUB_AGENT_TIMEOUT_MS = 600_000;
export const MAX_SUB_AGENT_OUTPUT_CHARS = 32_000;
export const MAX_SUB_AGENT_SUMMARY_CHARS = 2_000;
const TRUNCATION_MARKER = "\n...[truncated]";

export interface SubAgentRunInput {
  orgId: string;
  profileId: string;
  task: string;
  context?: string;
  timeoutMs?: number;
  userId?: string;
  clientOrigin?: string;
  agentDepth: number;
}

export interface SubAgentRunResult {
  status: "success" | "fail" | "timeout";
  summary: string;
  output: string;
  error?: string;
}

export function buildSubAgentResult(
  status: SubAgentRunResult["status"],
  text: string,
  error?: string,
): SubAgentRunResult {
  const output = truncateField(text, MAX_SUB_AGENT_OUTPUT_CHARS);
  const summary = truncateField(text, MAX_SUB_AGENT_SUMMARY_CHARS);

  return {
    status,
    summary,
    output,
    ...(error ? { error } : {}),
  };
}

export function failSubAgentResult(error: string): SubAgentRunResult {
  return {
    status: "fail",
    summary: error,
    output: "",
    error,
  };
}

export function buildSubAgentPrompt(task: string, context?: string): string {
  const parts = [`# Task\n${task.trim()}`];

  if (context?.trim()) {
    parts.push(`# Context\n${context.trim()}`);
  }

  return parts.join("\n\n");
}

function truncateField(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const keep = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  return `${value.slice(0, keep)}${TRUNCATION_MARKER}`;
}
