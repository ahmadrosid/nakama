import type {
  GenerateChatInput,
  GenerateTextInput,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { createAnthropicProvider } from "../anthropic";
import { createOpenAIProvider } from "../openai";

const COMMAND_CODE_CHAT_BASE_URL = "https://api.commandcode.ai/provider/v1";

const COMMAND_CODE_MESSAGES_BASE_URL = "https://api.commandcode.ai/provider";

// Command Code serves Claude models only on the Anthropic Messages endpoint.
// Every other model answers on Chat Completions, so the model id picks the wire.
const MESSAGES_MODEL_PREFIX = "claude-";

export interface CommandCodeProviderOptions {
  apiKey: string;
  model?: string;
}

export function createCommandCodeProvider(
  options: CommandCodeProviderOptions
): ProviderClient {
  const model = options.model ?? "deepseek/deepseek-v4.1-flash";

  if (model.startsWith(MESSAGES_MODEL_PREFIX)) {
    const anthropic = createAnthropicProvider({
      apiKey: options.apiKey,
      baseUrl: COMMAND_CODE_MESSAGES_BASE_URL,
      model,
      providerLabel: "Command Code",
      providerName: "command_code",
    });

    return {
      generateChat: (input: GenerateChatInput) =>
        anthropic.generateChat({ ...input, providerOptions: undefined }),
      generateText: (input: GenerateTextInput) => anthropic.generateText(input),
      name: "command_code",
      streamChat: (input: GenerateChatInput, handlers: StreamChatHandlers) =>
        anthropic.streamChat(
          { ...input, providerOptions: undefined },
          handlers
        ),
    };
  }

  return createOpenAIProvider({
    apiKey: options.apiKey,
    baseUrl: COMMAND_CODE_CHAT_BASE_URL,
    model,
    providerName: "command_code",
  });
}
