import { normalizeBaseUrl, type ProviderClient } from "@nakama/core";
import { createAnthropicProvider } from "../anthropic";
import { createOpenAIProvider } from "../openai";

const DEFAULT_CHAT_BASE_URL = "https://api.commandcode.ai/provider/v1";

// Command Code serves Claude models only on the Anthropic Messages endpoint.
// Every other model answers on Chat Completions, so the model id picks the wire.
const MESSAGES_MODEL_PREFIX = "claude-";

export interface CommandCodeProviderOptions {
  apiKey: string;
  /** OpenAI-style base URL. Claude models use the same host without `/v1`. */
  baseUrl?: string;
  model?: string;
}

// The Anthropic SDK appends `/v1/messages`, so its base drops the OpenAI `/v1`.
function messagesBaseUrl(chatBaseUrl: string): string {
  return chatBaseUrl.replace(/\/v1$/, "");
}

export function createCommandCodeProvider(
  options: CommandCodeProviderOptions
): ProviderClient {
  const model = options.model ?? "deepseek/deepseek-v4.1-flash";

  const chatBaseUrl = normalizeBaseUrl(
    options.baseUrl?.trim() || DEFAULT_CHAT_BASE_URL
  );

  if (model.startsWith(MESSAGES_MODEL_PREFIX)) {
    // Real Claude models keep the Anthropic thinking and web-search options.
    return createAnthropicProvider({
      apiKey: options.apiKey,
      baseUrl: messagesBaseUrl(chatBaseUrl),
      model,
      providerLabel: "Command Code",
      providerName: "command_code",
    });
  }

  return createOpenAIProvider({
    apiKey: options.apiKey,
    baseUrl: chatBaseUrl,
    model,
    providerName: "command_code",
  });
}
