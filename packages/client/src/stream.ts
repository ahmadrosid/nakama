import { DEFAULT_CHAT_STREAM_TIMEOUT_MS } from "@nakama/core/chat-stream-timeout";
import type {
  AgentBrowserInstallEvent,
  AgentBrowserStatusResponse,
  SendMessageInput,
  StreamEvent,
} from "@nakama/core/contract";
import {
  BUN_FETCH_DISABLE_IDLE_TIMEOUT_S,
  withDisabledFetchIdle,
} from "@nakama/core/fetch-idle";
import { readBrowserOrigin } from "./browser";
import type { SendMessageArg, StreamHandler, StreamHandlers } from "./types";

const DEFAULT_STREAM_IDLE_MS = DEFAULT_CHAT_STREAM_TIMEOUT_MS;

/**
 * Bun fetch idleTimeout is in seconds (max 255). SSE tool runs can sit quiet
 * longer than that, so stream requests disable it.
 */
export const STREAM_FETCH_IDLE_TIMEOUT_S = BUN_FETCH_DISABLE_IDLE_TIMEOUT_S;

export type StreamFetchInit = RequestInit & { idleTimeout?: number };

export function withStreamFetchIdle(init: RequestInit): StreamFetchInit {
  return withDisabledFetchIdle(init);
}

/** How long a 409 is treated as a turn that is still stopping rather than a real conflict. */
const TURN_CONFLICT_RETRY_MS = 3000;
const TURN_CONFLICT_POLL_MS = 150;

export function isActiveTurnConflict(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("already in progress")
  );
}

/**
 * Cancelling a turn aborts the fetch, but the server only learns the client is
 * gone once the socket closes, measured at 30 to 45ms on loopback. A message
 * sent inside that window collides with a turn that is already dying and gets a
 * 409 the caller can do nothing about, so retry until the turn clears.
 *
 * Every channel hits this: Discord /stop then a follow-up, the web Stop button,
 * a closed tab followed by a resend.
 */
export async function retryWhileTurnIsStopping<T>(
  send: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<T> {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + TURN_CONFLICT_RETRY_MS;

  for (;;) {
    try {
      return await send();
    } catch (error) {
      if (
        options.signal?.aborted ||
        !isActiveTurnConflict(error) ||
        now() >= deadline
      ) {
        throw error;
      }

      await sleep(TURN_CONFLICT_POLL_MS);
    }
  }
}

export async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  idleMs = DEFAULT_STREAM_IDLE_MS
): Promise<string> {
  let reply = "";
  let sawDataEvent = false;

  const doneReply = await consumeSseEvents<StreamEvent, string>(
    body,
    (payload) => {
      if (payload.type === "chunk") {
        handlers.onChunk(payload.delta);
        reply += payload.delta;
      }

      if (payload.type === "thinking") {
        handlers.onThinking?.(payload.delta);
      }

      if (payload.type === "tool_input_delta") {
        handlers.onToolInputDelta?.({
          accumulatedArguments: payload.accumulatedArguments,
          delta: payload.delta,
          tool: payload.tool,
          toolCallId: payload.toolCallId,
        });
      }

      if (payload.type === "tool_start") {
        handlers.onToolStart?.({
          input: payload.input,
          tool: payload.tool,
          toolCallId: payload.toolCallId,
        });
      }

      if (payload.type === "tool_end") {
        handlers.onToolEnd?.({
          result: payload.result,
          tool: payload.tool,
          toolCallId: payload.toolCallId,
        });
      }

      if (payload.type === "sub_agent_activity") {
        handlers.onSubAgentActivity?.({
          label: payload.label,
          parentToolCallId: payload.parentToolCallId,
        });
      }

      if (payload.type === "todos_updated") {
        handlers.onTodosUpdated?.(payload.todos);
      }

      if (payload.type === "questionnaire_updated") {
        handlers.onQuestionnaireUpdated?.(payload.questionnaire);
      }

      if (payload.type === "done") {
        if (payload.contextUsage) {
          handlers.onContextUsage?.(payload.contextUsage);
        }
        return payload.reply;
      }

      if (payload.type === "error") {
        throw new Error(payload.error);
      }
    },
    signal,
    idleMs,
    () => {
      sawDataEvent = true;
    }
  );

  if (doneReply) {
    return doneReply;
  }

  if (!reply) {
    throw new Error(
      sawDataEvent
        ? "Stream ended before the model returned a reply."
        : "Stream ended without a response. Only server keepalive events were received — the LLM call likely failed or hung before producing output."
    );
  }

  return reply;
}

export interface AgentBrowserInstallStreamHandlers {
  onDone?: (status: AgentBrowserStatusResponse) => void;
  onProgress?: (message: string) => void;
}

export async function readAgentBrowserInstallStream(
  body: ReadableStream<Uint8Array>,
  handlers: AgentBrowserInstallStreamHandlers = {},
  signal?: AbortSignal
): Promise<AgentBrowserStatusResponse> {
  let status: AgentBrowserStatusResponse | null = null;

  const doneStatus = await consumeSseEvents<
    AgentBrowserInstallEvent,
    AgentBrowserStatusResponse
  >(
    body,
    (payload) => {
      if (payload.type === "progress") {
        handlers.onProgress?.(payload.message);
      }

      if (payload.type === "done") {
        status = payload.status;
        handlers.onDone?.(payload.status);
        return payload.status;
      }

      if (payload.type === "error") {
        throw new Error(payload.error);
      }
    },
    signal
  );

  if (doneStatus) {
    return doneStatus;
  }

  if (status) {
    return status;
  }

  throw new Error("Install stream ended without a completion event.");
}

async function consumeSseEvents<TEvent extends { type: string }, TResult>(
  body: ReadableStream<Uint8Array>,
  onEvent: (
    event: TEvent
  ) => TResult | undefined | Promise<TResult | undefined>,
  signal?: AbortSignal,
  idleMs = DEFAULT_STREAM_IDLE_MS,
  onDataEvent?: () => void
): Promise<TResult | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastDataAt = Date.now();

  const abortReader = () => {
    void reader.cancel();
  };

  signal?.addEventListener("abort", abortReader, { once: true });

  try {
    while (true) {
      if (Date.now() - lastDataAt >= idleMs) {
        throw new Error(
          `Chat stream timed out after ${Math.round(idleMs / 1000)}s waiting for the model. The provider may be rate-limited, misconfigured, or unavailable — try another model or check Settings.`
        );
      }

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf("\n\n");

        if (boundary < 0) {
          break;
        }

        const eventBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of eventBlock.split("\n")) {
          if (line.startsWith(":") || !line.startsWith("data: ")) {
            continue;
          }

          onDataEvent?.();
          lastDataAt = Date.now();

          const payload = JSON.parse(line.slice(6)) as TEvent;
          const result = await onEvent(payload);

          if (result !== undefined) {
            return result;
          }
        }
      }
    }

    if (signal?.aborted) {
    }
  } catch (error) {
    if (signal?.aborted) {
      return;
    }

    throw error;
  } finally {
    signal?.removeEventListener("abort", abortReader);
  }
}

export function normalizeStreamHandlers(
  handler: StreamHandler | StreamHandlers
): StreamHandlers {
  if (typeof handler === "function") {
    return { onChunk: handler };
  }

  return handler;
}

export function resolveSendMessageBody(
  input: SendMessageArg,
  defaultClientOrigin?: string
): SendMessageInput {
  const body = typeof input === "string" ? { message: input } : input;

  if (body.clientOrigin?.trim()) {
    return body;
  }

  const origin = readBrowserOrigin();
  if (origin) {
    return { ...body, clientOrigin: origin };
  }

  if (defaultClientOrigin?.trim()) {
    return { ...body, clientOrigin: defaultClientOrigin.replace(/\/$/, "") };
  }

  return body;
}
