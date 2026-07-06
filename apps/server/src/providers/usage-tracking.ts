import type {
  ChatCompletionResult,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { estimateUserContentTokens } from "@nakama/core";
import type { LlmUsageTracker } from "../services/llm-usage-tracker";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateChatInputTokens(input: GenerateChatInput): number {
  let total = estimateTokens(input.system);

  for (const message of input.messages) {
    if (message.role === "user") {
      total += estimateUserContentTokens(message.content);
      continue;
    }

    if (message.role === "assistant") {
      total += estimateTokens(message.content);

      if (message.toolCalls?.length) {
        total += estimateTokens(JSON.stringify(message.toolCalls));
      }

      if (message.thinking) {
        total += estimateTokens(message.thinking);
      }

      continue;
    }

    total += estimateTokens(message.content);
  }

  if (input.tools?.length) {
    total += estimateTokens(JSON.stringify(input.tools));
  }

  return total;
}

function estimateTextInputTokens(input: GenerateTextInput): number {
  return estimateTokens(`${input.system}\n${input.prompt}`);
}

function estimateChatOutputTokens(result: ChatCompletionResult): number {
  let total = estimateTokens(result.content);

  if (result.toolCalls.length > 0) {
    total += estimateTokens(JSON.stringify(result.toolCalls));
  }

  const thinking = result.assistantMessage.thinking;
  if (thinking) {
    total += estimateTokens(thinking);
  }

  return total;
}

export function wrapProviderWithUsageTracking(
  provider: ProviderClient,
  tracker: LlmUsageTracker,
  modelId: string,
): ProviderClient {
  function recordChat(input: GenerateChatInput, result: ChatCompletionResult): void {
    const inputTokens = result.usage?.inputTokens ?? estimateChatInputTokens(input);
    const outputTokens = result.usage?.outputTokens ?? estimateChatOutputTokens(result);
    tracker.record(modelId, inputTokens, outputTokens);
  }

  return {
    ...provider,
    async generateChat(input: GenerateChatInput): Promise<ChatCompletionResult> {
      const result = await provider.generateChat(input);
      recordChat(input, result);
      return result;
    },
    async streamChat(
      input: GenerateChatInput,
      handlers: StreamChatHandlers,
    ): Promise<ChatCompletionResult> {
      const result = await provider.streamChat(input, handlers);
      recordChat(input, result);
      return result;
    },
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const result = await provider.generateText(input);
      const inputTokens = result.usage?.inputTokens ?? estimateTextInputTokens(input);
      const outputTokens = result.usage?.outputTokens ?? estimateTokens(result.content);
      tracker.record(modelId, inputTokens, outputTokens);
      return result;
    },
  };
}
