import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  ProviderClient,
  ProviderName,
  StreamChatHandlers,
} from "@nakama/core";
import { buildTokenUsage } from "../shared";
import { continueAnthropicUntilDone } from "./web-search";

const DEFAULT_PROVIDER_LABEL = "Anthropic";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests to mock HTTP without touching global fetch. */
  fetch?: typeof fetch;
  model?: string;
  providerLabel?: string;
  providerName?: ProviderName;
}

function createAnthropicClient(
  apiKey: string,
  baseUrl?: string,
  fetchImpl?: typeof fetch
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
      `${label} request failed (${error.status}): ${error.message}`
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`${label} request failed.`);
}

async function withAnthropicError<T>(
  run: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw formatAnthropicError(error, label);
  }
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions
): ProviderClient {
  const model = options.model ?? "claude-sonnet-4-6";
  const client = createAnthropicClient(
    options.apiKey,
    options.baseUrl,
    options.fetch
  );
  const name: ProviderName = options.providerName ?? "anthropic";
  const label = options.providerLabel ?? DEFAULT_PROVIDER_LABEL;

  return {
    generateChat(input: GenerateChatInput) {
      return withAnthropicError(
        () =>
          continueAnthropicUntilDone({
            client,
            messages: input.messages,
            model,
            provider: name,
            stream: false,
            system: input.system,
            thinking: input.providerOptions,
            tools: input.tools,
            webSearch: input.providerOptions?.webSearch ?? false,
          }),
        label
      );
    },
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? `${input.system}\n\nRespond with valid JSON only.`
        : `${input.system}\n\nReturn only the requested text. No JSON, labels, or markdown fences.`;

      return withAnthropicError(async () => {
        const message = await client.messages.create({
          max_tokens: 2048,
          messages: [{ content: input.prompt, role: "user" }],
          model,
          system,
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
    name,
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return withAnthropicError(
        () =>
          continueAnthropicUntilDone({
            client,
            handlers,
            messages: input.messages,
            model,
            provider: name,
            stream: true,
            system: input.system,
            thinking: input.providerOptions,
            tools: input.tools,
            webSearch: input.providerOptions?.webSearch ?? false,
          }),
        label
      );
    },
  };
}

export {
  buildAnthropicTools,
  parseAnthropicContent,
  toAnthropicMessages,
} from "./web-search";
