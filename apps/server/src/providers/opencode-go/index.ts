import { randomUUID } from "node:crypto";
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
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  model?: string;
  sessionId?: string;
}

export function formatOpenCodeSessionId(sessionId?: string): string {
  if (!sessionId?.trim()) {
    return `ses_${randomUUID().replace(/-/g, "")}`;
  }

  const trimmed = sessionId.trim();

  if (trimmed.startsWith("ses_")) {
    return trimmed;
  }

  const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");

  return `ses_${sanitized}`;
}

export function createOpenCodeGoProvider(
  options: OpenCodeGoProviderOptions
): ProviderClient {
  const model = options.model ?? "opencode-go/kimi-k2.7-code";
  const useMessages = MESSAGES_MODELS.has(model);

  const explicitSession =
    options.sessionId ??
    options.extraHeaders?.["x-opencode-session"] ??
    options.extraHeaders?.["X-OpenCode-Session"];

  const sessionId = formatOpenCodeSessionId(explicitSession);

  const extraHeaders = {
    ...options.extraHeaders,
    "x-opencode-session": sessionId,
  };

  if (useMessages) {
    const anthropic = createAnthropicProvider({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? OPENCODE_GO_MESSAGES_BASE_URL,
      defaultHeaders: extraHeaders,
      model,
      providerLabel: "OpenCode Go",
      providerName: "opencode_go",
    });

    return {
      generateChat: (input: GenerateChatInput) =>
        anthropic.generateChat({ ...input, providerOptions: undefined }),
      generateText: (input: GenerateTextInput) => anthropic.generateText(input),
      name: "opencode_go",
      streamChat: (input: GenerateChatInput, handlers: StreamChatHandlers) =>
        anthropic.streamChat(
          { ...input, providerOptions: undefined },
          handlers
        ),
    };
  }

  return createOpenAIProvider({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? OPENCODE_GO_CHAT_BASE_URL,
    extraHeaders,
    model,
    providerName: "opencode_go",
  });
}
