import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
} from "@nakama/core";

export function createCapturingProvider(
  response: ChatCompletionResult,
  options: {
    name?: ProviderClient["name"];
    thinking?: string;
  } = {}
): ProviderClient & { lastInput?: GenerateChatInput } {
  const provider: ProviderClient & { lastInput?: GenerateChatInput } = {
    generateChat(input) {
      provider.lastInput = input;
      return Promise.resolve(response);
    },
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    name: options.name ?? "anthropic",
    streamChat(input, handlers) {
      provider.lastInput = input;
      if (options.thinking) {
        handlers.onThinking?.(options.thinking);
      }
      if (response.content) {
        handlers.onChunk(response.content);
      }
      return Promise.resolve(response);
    },
  };

  return provider;
}
