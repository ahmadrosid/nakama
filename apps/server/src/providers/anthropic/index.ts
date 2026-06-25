import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  GenerateChatInput,
  GenerateTextResult,
  GenerateTextInput,
  ProviderClient,
  ProviderName,
  StreamChatHandlers,
} from "@tinyclaw/core";
import { continueAnthropicUntilDone } from "./web-search";
import { buildTokenUsage } from "../shared";

const DEFAULT_PROVIDER_LABEL = "Anthropic";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injected in tests to mock HTTP without touching global fetch. */
  fetch?: typeof fetch;
  providerName?: ProviderName;
  providerLabel?: string;
}

function createAnthropicClient(
  apiKey: string,
  baseUrl?: string,
  fetchImpl?: typeof fetch,
): Anthropic {
  return new Anthropic({
    apiKey,
    ...(baseUrl?.trim() ? { baseURL: baseUrl.trim() } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

function formatAnthropicError(error: unknown, label: string): Error {
  if (error instanceof APIError) {
    return new Error(
      `${label} request failed (${error.status}): ${error.message}`,
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`${label} request failed.`);
}

async function withAnthropicError<T>(
  run: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw formatAnthropicError(error, label);
  }
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): ProviderClient {
  const model = options.model ?? "claude-sonnet-4-6";
  const client = createAnthropicClient(options.apiKey, options.baseUrl, options.fetch);
  const name: ProviderName = options.providerName ?? "anthropic";
  const label = options.providerLabel ?? DEFAULT_PROVIDER_LABEL;

  return {
    name,
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
          throw new Error(`${label} returned an empty response.`);
        }

        const usage = buildTokenUsage({
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
        });

        return {
          content,
          ...(usage ? { usage } : {}),
        } satisfies GenerateTextResult;
      }, label);
    },
    generateChat(input: GenerateChatInput) {
      return withAnthropicError(
        () =>
          continueAnthropicUntilDone({
            client,
            model,
            system: input.system,
            messages: input.messages,
            tools: input.tools,
            webSearch: input.providerOptions?.webSearch ?? false,
            thinking: input.providerOptions,
            stream: false,
            provider: name,
          }),
        label,
      );
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return withAnthropicError(
        () =>
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
            provider: name,
          }),
        label,
      );
    },
  };
}

export {
  buildAnthropicTools,
  parseAnthropicContent,
  toAnthropicMessages,
} from "./web-search";
