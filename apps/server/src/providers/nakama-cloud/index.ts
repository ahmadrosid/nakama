import {
  type ChatCompletionResult,
  type GenerateChatInput,
  type GenerateTextInput,
  type GenerateTextResult,
  NakamaApiError,
  type ProviderClient,
  type StreamChatHandlers,
} from "@nakama/core";
import { z } from "zod";
import type { LlmStreamEvent } from "../../http/routes/llm";
import {
  CLOUD_UNREACHABLE,
  type NakamaCloudPasses,
  SIGN_IN_AGAIN,
} from "./passes";

export { NakamaCloudPasses } from "./passes";

export {
  activeNakamaCloudPasses,
  NAKAMA_CLOUD_PROVIDER_ID,
  type NakamaCloudConnection,
  NakamaCloudSignIn,
  useNakamaCloudSignIn,
} from "./sign-in";

const errorBodySchema = z.object({ error: z.string() });

const textResultSchema = z.object({
  content: z.string(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
});

export interface NakamaCloudProviderOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  model: string;
  passes: NakamaCloudPasses;
}

/** One SSE frame from the cloud. The cloud is trusted to send its own events. */
function parseEvent(frame: string): LlmStreamEvent | null {
  if (!frame.startsWith("data: ")) {
    return null;
  }

  // SAFETY: /v1/llm/chat writes only LlmStreamEvent frames (routes/llm.ts).
  return JSON.parse(frame.slice(6)) as LlmStreamEvent;
}

function replay(event: LlmStreamEvent, handlers: StreamChatHandlers): void {
  switch (event.type) {
    case "chunk": {
      handlers.onChunk(event.data);

      return;
    }

    case "thinking": {
      handlers.onThinking?.(event.data);

      return;
    }

    case "toolEnd": {
      handlers.onToolEnd?.(event.data);

      return;
    }

    case "toolInputDelta": {
      handlers.onToolInputDelta?.(event.data);

      return;
    }

    case "toolStart": {
      handlers.onToolStart?.(event.data);

      return;
    }

    default: {
      return;
    }
  }
}

/**
 * The team's models through Nakama Cloud. The model runs in the cloud with
 * the org's keys; tools still run here, in the local agent loop.
 */
export function createNakamaCloudProvider(
  options: NakamaCloudProviderOptions
): ProviderClient {
  const fetchImpl = options.fetch ?? fetch;

  /** POST with the pass; one retry with a fresh pass after a 401. */
  async function post(
    path: string,
    body: string,
    signal?: AbortSignal
  ): Promise<Response> {
    for (const attempt of [0, 1]) {
      const pass = await options.passes.get();
      let response: Response;

      try {
        response = await fetchImpl(`${options.baseUrl}${path}`, {
          body,
          headers: {
            authorization: `Bearer ${pass}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal,
        });
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }

        throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
      }

      if (response.status === 401 && attempt === 0) {
        options.passes.invalidate();

        continue;
      }

      if (response.status === 401) {
        throw new NakamaApiError(SIGN_IN_AGAIN, 401);
      }

      if (!response.ok) {
        const parsed = errorBodySchema.safeParse(
          await response.json().catch(() => null)
        );

        throw new NakamaApiError(
          parsed.success ? parsed.data.error : CLOUD_UNREACHABLE,
          response.status
        );
      }

      return response;
    }

    throw new NakamaApiError(SIGN_IN_AGAIN, 401);
  }

  async function streamChat(
    input: GenerateChatInput,
    handlers: StreamChatHandlers
  ): Promise<ChatCompletionResult> {
    const { signal, ...rest } = input;

    const response = await post(
      "/v1/llm/chat",
      JSON.stringify({ ...rest, model: options.model }),
      signal
    );

    if (!response.body) {
      throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
    }

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();

    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += value;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = parseEvent(frame);

        if (event?.type === "result") {
          void reader.cancel();

          return event.data;
        }

        if (event?.type === "error") {
          void reader.cancel();
          throw new NakamaApiError(event.data.message, event.data.status);
        }

        if (event) {
          replay(event, handlers);
        }
      }
    }

    throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
  }

  return {
    generateChat: (input) => streamChat(input, { onChunk: () => undefined }),
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const response = await post(
        "/v1/llm/text",
        JSON.stringify({ ...input, model: options.model })
      );

      return textResultSchema.parse(await response.json());
    },
    name: "nakama_cloud",
    streamChat,
  };
}
