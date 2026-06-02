import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  GenerateChatInput,
  GenerateTextInput,
  ProviderClient,
  StreamChatHandlers,
} from "@tinyclaw/core";
import { continueAnthropicUntilDone } from "./web-search";

const PROVIDER_LABEL = "Anthropic";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests to mock HTTP without touching global fetch. */
  fetch?: typeof fetch;
}

function createAnthropicClient(
  apiKey: string,
  fetchImpl?: typeof fetch,
): Anthropic {
  return new Anthropic({
    apiKey,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

function formatAnthropicError(error: unknown): Error {
  if (error instanceof APIError) {
    return new Error(
      `${PROVIDER_LABEL} request failed (${error.status}): ${error.message}`,
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`${PROVIDER_LABEL} request failed.`);
}

async function withAnthropicError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw formatAnthropicError(error);
  }
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): ProviderClient {
  const model = options.model ?? "claude-sonnet-4-6";
  const client = createAnthropicClient(options.apiKey, options.fetch);

  return {
    name: "anthropic",
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? `${input.system}\n\nRespond with valid JSON only.`
        : `${input.system}\n\nReturn only the requested text. No JSON, labels, or markdown fences.`;

      return withAnthropicError(async () => {
        const message = await client.messages.create({
          model,
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: input.prompt }],
        });

        const content = message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("")
          .trim();

        if (!content) {
          throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
        }

        return content;
      });
    },
    generateChat(input: GenerateChatInput) {
      return withAnthropicError(() =>
        continueAnthropicUntilDone({
          client,
          model,
          system: input.system,
          messages: input.messages,
          tools: input.tools,
          webSearch: input.providerOptions?.webSearch ?? false,
          thinking: input.providerOptions,
          stream: false,
        }),
      );
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return withAnthropicError(() =>
        continueAnthropicUntilDone({
          client,
          model,
          system: input.system,
          messages: input.messages,
          tools: input.tools,
          webSearch: input.providerOptions?.webSearch ?? false,
          thinking: input.providerOptions,
          stream: true,
          handlers,
        }),
      );
    },
  };
}

export {
  buildAnthropicTools,
  parseAnthropicContent,
  toAnthropicMessages,
} from "./web-search";
