import type {
  GenerateChatInput,
  GenerateTextInput,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { createAnthropicProvider } from "../anthropic";
import { createOpenAIProvider } from "../openai";

const OPENCODE_GO_CHAT_BASE_URL = "https://opencode.ai/zen/go/v1";
const OPENCODE_GO_MESSAGES_BASE_URL = "https://opencode.ai/zen/go";

const MESSAGES_MODELS = new Set([
  "opencode-go/minimax-m3",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m2.5",
  "opencode-go/qwen3.7-max",
  "opencode-go/qwen3.7-plus",
  "opencode-go/qwen3.6-plus",
  "opencode-go/qwen3.5-plus",
]);

export interface OpenCodeGoProviderOptions {
  apiKey: string;
  model?: string;
}

export function createOpenCodeGoProvider(
  options: OpenCodeGoProviderOptions,
): ProviderClient {
  const model = options.model ?? "opencode-go/kimi-k2.7-code";
  const useMessages = MESSAGES_MODELS.has(model);

  if (useMessages) {
    const anthropic = createAnthropicProvider({
      apiKey: options.apiKey,
      model,
      baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
      providerName: "opencode_go",
      providerLabel: "OpenCode Go",
    });

    return {
      name: "opencode_go",
      generateText: (input: GenerateTextInput) => anthropic.generateText(input),
      generateChat: (input: GenerateChatInput) =>
        anthropic.generateChat({ ...input, providerOptions: undefined }),
      streamChat: (input: GenerateChatInput, handlers: StreamChatHandlers) =>
        anthropic.streamChat({ ...input, providerOptions: undefined }, handlers),
    };
  }

  return createOpenAIProvider({
    apiKey: options.apiKey,
    model,
    baseUrl: OPENCODE_GO_CHAT_BASE_URL,
    providerName: "opencode_go",
  });
}
