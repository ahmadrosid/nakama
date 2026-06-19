import type { SendMessageInput, StreamEvent } from "@tinyclaw/core/contract";
import type { SendMessageArg, StreamHandler, StreamHandlers } from "./types";

const DEFAULT_STREAM_IDLE_MS = 120_000;

export async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  idleMs = DEFAULT_STREAM_IDLE_MS,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let sawDataEvent = false;
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

          sawDataEvent = true;
          lastDataAt = Date.now();

          const payload = JSON.parse(line.slice(6)) as StreamEvent;

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

          if (payload.type === "done") {
            return payload.reply;
          }

          if (payload.type === "error") {
            throw new Error(payload.error);
          }
        }
      }
    }

    if (signal?.aborted) {
      return reply;
    }

    if (!reply) {
      throw new Error(
        sawDataEvent
          ? "Stream ended before the model returned a reply."
          : "Stream ended without a response. Only server keepalive events were received — the LLM call likely failed or hung before producing output.",
      );
    }

    return reply;
  } catch (error) {
    if (signal?.aborted) {
      return reply;
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

export function resolveSendMessageBody(input: SendMessageArg): SendMessageInput {
  return typeof input === "string" ? { message: input } : input;
}
