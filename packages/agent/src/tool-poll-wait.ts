import type { ToolCall, ToolContext, ToolDefinition } from "@nakama/core";
import { executeToolCall } from "./tool-loop";

export const TOOL_POLL_WAIT_AFTER_CALLS = 3;
export const TOOL_POLL_WAIT_TIMEOUT_MS = 120_000;
export const TOOL_POLL_WAIT_INITIAL_DELAY_MS = 500;
export const TOOL_POLL_WAIT_MAX_DELAY_MS = 5000;

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "done",
  "error",
  "failed",
  "failure",
  "ok",
  "success",
  "succeeded",
  "timed_out",
  "timeout",
]);

export interface ToolPollWaitClock {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ToolPollWaitState {
  counts: Map<string, number>;
  lastReturned: Map<string, string>;
  latched: Set<string>;
}

export interface ExecuteToolCallWithPollWaitInput {
  call: ToolCall;
  clock?: ToolPollWaitClock;
  context?: ToolContext;
  state: ToolPollWaitState;
  timeoutMs?: number;
  tools: ToolDefinition[];
}

export function createToolPollWaitState(): ToolPollWaitState {
  return {
    counts: new Map(),
    lastReturned: new Map(),
    latched: new Set(),
  };
}

export const defaultToolPollWaitClock: ToolPollWaitClock = {
  now: () => Date.now(),
  sleep: sleepUntilAbort,
};

export function toolPollWaitKey(name: string, args: unknown): string {
  return `${name}:${stableSerialize(args)}`;
}

export function unwrapToolPayload(result: unknown): unknown {
  if (!isRecord(result)) {
    return result;
  }

  if (typeof result.text === "string") {
    const parsed = tryParseJson(result.text);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  if (Array.isArray(result.content)) {
    const chunks: string[] = [];

    for (const part of result.content) {
      if (
        isRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string"
      ) {
        chunks.push(part.text);
      }
    }

    if (chunks.length > 0) {
      const parsed = tryParseJson(chunks.join("\n"));
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  return result;
}

export function isToolErrorResult(result: unknown): boolean {
  return isRecord(result) && typeof result.error === "string";
}

export function isTerminalSnapshot(result: unknown): boolean {
  if (isToolErrorResult(result)) {
    return true;
  }

  const payload = unwrapToolPayload(result);
  if (!isRecord(payload)) {
    return false;
  }

  if (
    payload.done === true ||
    payload.complete === true ||
    payload.finished === true
  ) {
    return true;
  }

  const status = snapshotStatus(payload);
  return status !== null && TERMINAL_STATUSES.has(status);
}

export function canPollWaitOnResult(result: unknown): boolean {
  if (isToolErrorResult(result) || isTerminalSnapshot(result)) {
    return false;
  }

  const payload = unwrapToolPayload(result);
  if (!isRecord(payload)) {
    return false;
  }

  const status = snapshotStatus(payload);
  if (status !== null) {
    return !TERMINAL_STATUSES.has(status);
  }

  const percent = progressPercent(payload);
  return percent !== null && percent < 100;
}

export function payloadsEqual(left: unknown, right: unknown): boolean {
  return (
    stableSerialize(unwrapToolPayload(left)) ===
    stableSerialize(unwrapToolPayload(right))
  );
}

export function withPollTimeout(result: unknown, waitedMs: number): unknown {
  if (isRecord(result)) {
    return {
      ...result,
      poll_timeout: true,
      waited_ms: waitedMs,
    };
  }

  return {
    poll_timeout: true,
    result,
    waited_ms: waitedMs,
  };
}

export async function executeToolCallWithPollWait(
  input: ExecuteToolCallWithPollWaitInput
): Promise<unknown> {
  const clock = input.clock ?? defaultToolPollWaitClock;
  const context = input.context ?? {};
  const timeoutMs = input.timeoutMs ?? TOOL_POLL_WAIT_TIMEOUT_MS;
  const key = toolPollWaitKey(input.call.name, input.call.arguments);
  const count = (input.state.counts.get(key) ?? 0) + 1;
  input.state.counts.set(key, count);

  const first = await executeToolCall(input.tools, input.call, context);
  return finishOrWait({
    call: input.call,
    clock,
    context,
    count,
    first,
    key,
    state: input.state,
    timeoutMs,
    tools: input.tools,
  });
}

async function finishOrWait(input: {
  call: ToolCall;
  clock: ToolPollWaitClock;
  context: ToolContext;
  count: number;
  first: unknown;
  key: string;
  state: ToolPollWaitState;
  timeoutMs: number;
  tools: ToolDefinition[];
}): Promise<unknown> {
  if (!canPollWaitOnResult(input.first)) {
    return rememberReturned(input.state, input.key, input.first);
  }

  if (input.count >= TOOL_POLL_WAIT_AFTER_CALLS) {
    input.state.latched.add(input.key);
  }

  if (!input.state.latched.has(input.key)) {
    return rememberReturned(input.state, input.key, input.first);
  }

  const previous = input.state.lastReturned.get(input.key);
  if (
    previous !== undefined &&
    stableSerialize(unwrapToolPayload(input.first)) !== previous
  ) {
    return rememberReturned(input.state, input.key, input.first);
  }

  return waitUntilPayloadChanges(input);
}

async function waitUntilPayloadChanges(input: {
  call: ToolCall;
  clock: ToolPollWaitClock;
  context: ToolContext;
  first: unknown;
  key: string;
  state: ToolPollWaitState;
  timeoutMs: number;
  tools: ToolDefinition[];
}): Promise<unknown> {
  const startedAt = input.clock.now();
  let delayMs = TOOL_POLL_WAIT_INITIAL_DELAY_MS;
  let last = input.first;

  while (true) {
    input.context.signal?.throwIfAborted();
    const waitedMs = input.clock.now() - startedAt;
    if (waitedMs >= input.timeoutMs) {
      return rememberReturned(
        input.state,
        input.key,
        withPollTimeout(last, waitedMs)
      );
    }

    await input.clock.sleep(
      Math.min(delayMs, input.timeoutMs - waitedMs),
      input.context.signal
    );
    input.context.signal?.throwIfAborted();

    last = await executeToolCall(input.tools, input.call, input.context);

    if (!(canPollWaitOnResult(last) && payloadsEqual(last, input.first))) {
      return rememberReturned(input.state, input.key, last);
    }

    delayMs = Math.min(delayMs * 2, TOOL_POLL_WAIT_MAX_DELAY_MS);
  }
}

function rememberReturned(
  state: ToolPollWaitState,
  key: string,
  result: unknown
): unknown {
  state.lastReturned.set(key, stableSerialize(unwrapToolPayload(result)));
  return result;
}

function snapshotStatus(payload: Record<string, unknown>): string | null {
  for (const field of [
    "status",
    "state",
    "job_status",
    "task_status",
  ] as const) {
    const value = payload[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().toLowerCase().replaceAll(" ", "_");
    }
  }

  return null;
}

function progressPercent(payload: Record<string, unknown>): number | null {
  if (!isRecord(payload.progress)) {
    return null;
  }

  const percent = payload.progress.percent;
  return typeof percent === "number" && Number.isFinite(percent)
    ? percent
    : null;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {}
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sleepUntilAbort(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0) {
    signal?.throwIfAborted();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(abortReason(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal?: AbortSignal): unknown {
  return (
    signal?.reason ??
    new DOMException("This operation was aborted", "AbortError")
  );
}
