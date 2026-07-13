import type {
  CodingHarnessInstallEvent,
  CodingHarnessStatus,
  SendMessageInput,
  StreamEvent,
} from "@nakama/core/contract";
import type { SendMessageArg, StreamHandler, StreamHandlers } from "./types";

const DEFAULT_STREAM_IDLE_MS = 600_000;

export async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  idleMs = DEFAULT_STREAM_IDLE_MS,
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

      if (payload.type === "tool_start") {
        handlers.onToolStart?.({
          toolCallId: payload.toolCallId,
          tool: payload.tool,
          input: payload.input,
        });
      }

      if (payload.type === "tool_end") {
        handlers.onToolEnd?.({
          toolCallId: payload.toolCallId,
          tool: payload.tool,
          result: payload.result,
        });
      }

      if (payload.type === "todos_updated") {
        handlers.onTodosUpdated?.(payload.todos);
      }

      if (payload.type === "questionnaire_updated") {
        handlers.onQuestionnaireUpdated?.(payload.questionnaire);
      }

      if (payload.type === "done") {
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
    },
  );

  if (doneReply) {
    return doneReply;
  }

  if (!reply) {
    throw new Error(
      sawDataEvent
        ? "Stream ended before the model returned a reply."
        : "Stream ended without a response. Only server keepalive events were received — the LLM call likely failed or hung before producing output.",
    );
  }

  return reply;
}

export interface CodingHarnessInstallStreamHandlers {
  onProgress?: (message: string) => void;
  onDone?: (status: CodingHarnessStatus) => void;
}

export async function readCodingHarnessInstallStream(
  body: ReadableStream<Uint8Array>,
  handlers: CodingHarnessInstallStreamHandlers = {},
  signal?: AbortSignal,
): Promise<CodingHarnessStatus> {
  let status: CodingHarnessStatus | null = null;

  const doneStatus = await consumeSseEvents<CodingHarnessInstallEvent, CodingHarnessStatus>(
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
    signal,
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
  onEvent: (event: TEvent) => TResult | undefined | Promise<TResult | undefined>,
  signal?: AbortSignal,
  idleMs = DEFAULT_STREAM_IDLE_MS,
  onDataEvent?: () => void,
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
          `Chat stream timed out after ${Math.round(idleMs / 1000)}s waiting for the model. The provider may be rate-limited, misconfigured, or unavailable — try another model or check Settings.`,
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
      return undefined;
    }

    return undefined;
  } catch (error) {
    if (signal?.aborted) {
      return undefined;
    }

    throw error;
  } finally {
    signal?.removeEventListener("abort", abortReader);
  }
}

export function normalizeStreamHandlers(
  handler: StreamHandler | StreamHandlers,
): StreamHandlers {
  if (typeof handler === "function") {
    return { onChunk: handler };
  }

  return handler;
}

export function resolveSendMessageBody(
  input: SendMessageArg,
  defaultClientOrigin?: string,
): SendMessageInput {
  const body = typeof input === "string" ? { message: input } : input;

  if (body.clientOrigin?.trim()) {
    return body;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return { ...body, clientOrigin: window.location.origin };
  }

  if (defaultClientOrigin?.trim()) {
    return { ...body, clientOrigin: defaultClientOrigin.replace(/\/$/, "") };
  }

  return body;
}
