import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  LlmToolDefinition,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { estimateUserContentTokens } from "@nakama/core";
import type { LlmUsageTracker } from "../services/llm-usage-tracker";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isTokenDebugEnabled(): boolean {
  const value = process.env.NAKAMA_DEBUG_TOKENS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export type ToolTokenEstimate = {
  name: string;
  chars: number;
  tokens: number;
  descriptionChars: number;
  parametersChars: number;
};

export type SystemSectionEstimate = {
  title: string;
  chars: number;
  tokens: number;
};

export type ChatTokenEstimateBreakdown = {
  systemChars: number;
  systemTokens: number;
  systemSections: SystemSectionEstimate[];
  toolsChars: number;
  toolsTokens: number;
  toolsCount: number;
  toolsBySize: ToolTokenEstimate[];
  messagesTokens: number;
  messageCount: number;
  messagesByRole: {
    user: number;
    assistant: number;
    tool: number;
    other: number;
  };
  totalEstimatedInputTokens: number;
};

function estimateMessageTokens(message: ChatMessage): number {
  if (message.role === "user") {
    return estimateUserContentTokens(message.content);
  }

  if (message.role === "assistant") {
    let total = estimateTokens(message.content);

    if (message.toolCalls?.length) {
      total += estimateTokens(JSON.stringify(message.toolCalls));
    }

    if (message.thinking) {
      total += estimateTokens(message.thinking);
    }

    return total;
  }

  return estimateTokens(message.content);
}

export function estimateToolToken(tool: LlmToolDefinition): ToolTokenEstimate {
  const serialized = JSON.stringify(tool);
  const descriptionChars = tool.description.length;
  const parametersChars = JSON.stringify(tool.parameters).length;

  return {
    name: tool.name,
    chars: serialized.length,
    tokens: estimateTokens(serialized),
    descriptionChars,
    parametersChars,
  };
}

/** Split system prompt on markdown `#` headings for a coarse section cost map. */
export function estimateSystemSections(system: string): SystemSectionEstimate[] {
  const lines = system.split("\n");
  const sections: { title: string; body: string[] }[] = [
    { title: "(preamble)", body: [] },
  ];

  for (const line of lines) {
    if (line.startsWith("# ")) {
      sections.push({ title: line.slice(2).trim() || "(untitled)", body: [line] });
      continue;
    }

    sections[sections.length - 1]?.body.push(line);
  }

  return sections
    .map((section) => {
      const text = section.body.join("\n").trim();
      if (!text) {
        return null;
      }

      return {
        title: section.title,
        chars: text.length,
        tokens: estimateTokens(text),
      };
    })
    .filter((section): section is SystemSectionEstimate => section !== null)
    .sort((left, right) => right.tokens - left.tokens || left.title.localeCompare(right.title));
}

export function estimateChatInputBreakdown(
  input: GenerateChatInput,
): ChatTokenEstimateBreakdown {
  const systemChars = input.system.length;
  const systemTokens = estimateTokens(input.system);
  const systemSections = estimateSystemSections(input.system);
  const toolsBySize = (input.tools ?? [])
    .map(estimateToolToken)
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name));
  const toolsJson = input.tools?.length ? JSON.stringify(input.tools) : "";
  const toolsChars = toolsJson.length;
  const toolsTokens = toolsChars > 0 ? estimateTokens(toolsJson) : 0;
  const toolsCount = input.tools?.length ?? 0;

  const messagesByRole = {
    user: 0,
    assistant: 0,
    tool: 0,
    other: 0,
  };
  let messagesTokens = 0;

  for (const message of input.messages) {
    messagesTokens += estimateMessageTokens(message);

    if (message.role === "user") {
      messagesByRole.user += 1;
    } else if (message.role === "assistant") {
      messagesByRole.assistant += 1;
    } else if (message.role === "tool") {
      messagesByRole.tool += 1;
    } else {
      messagesByRole.other += 1;
    }
  }

  return {
    systemChars,
    systemTokens,
    systemSections,
    toolsChars,
    toolsTokens,
    toolsCount,
    toolsBySize,
    messagesTokens,
    messageCount: input.messages.length,
    messagesByRole,
    totalEstimatedInputTokens: systemTokens + toolsTokens + messagesTokens,
  };
}

function estimateChatInputTokens(input: GenerateChatInput): number {
  return estimateChatInputBreakdown(input).totalEstimatedInputTokens;
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

function formatTokenDebugSummary(
  modelId: string,
  estimate: ChatTokenEstimateBreakdown,
  recorded: { inputTokens: number; outputTokens: number; source: "provider" | "estimate" },
): string {
  const lines = [
    `[nakama:tokens] summary model=${modelId} recordedInput=${recorded.inputTokens} recordedOutput=${recorded.outputTokens} source=${recorded.source} estimatedInput=${estimate.totalEstimatedInputTokens}`,
    `  system: ${estimate.systemTokens} tokens (${estimate.systemChars} chars)`,
  ];

  for (const section of estimate.systemSections.slice(0, 12)) {
    lines.push(`    - ${section.title}: ${section.tokens} tokens (${section.chars} chars)`);
  }

  if (estimate.systemSections.length > 12) {
    lines.push(`    - … ${estimate.systemSections.length - 12} more system sections`);
  }

  lines.push(
    `  tools: ${estimate.toolsTokens} tokens (${estimate.toolsChars} chars) across ${estimate.toolsCount} tools`,
  );

  for (const [index, tool] of estimate.toolsBySize.slice(0, 25).entries()) {
    lines.push(
      `    ${String(index + 1).padStart(2, " ")}. ${tool.name}: ${tool.tokens} tokens (desc ${tool.descriptionChars}, params ${tool.parametersChars})`,
    );
  }

  if (estimate.toolsBySize.length > 25) {
    const rest = estimate.toolsBySize.slice(25);
    const restTokens = rest.reduce((sum, tool) => sum + tool.tokens, 0);
    lines.push(`    … ${rest.length} more tools totaling ~${restTokens} tokens`);
  }

  lines.push(
    `  messages: ${estimate.messagesTokens} tokens across ${estimate.messageCount} messages (${estimate.messagesByRole.user} user / ${estimate.messagesByRole.assistant} assistant / ${estimate.messagesByRole.tool} tool)`,
  );

  return lines.join("\n");
}

function dumpChatTokenDebug(
  modelId: string,
  input: GenerateChatInput,
  result: ChatCompletionResult,
  recorded: { inputTokens: number; outputTokens: number; source: "provider" | "estimate" },
): void {
  if (!isTokenDebugEnabled()) {
    return;
  }

  const estimate = estimateChatInputBreakdown(input);
  console.info(formatTokenDebugSummary(modelId, estimate, recorded));
  console.info(
    "[nakama:tokens]",
    JSON.stringify({
      modelId,
      estimate,
      providerUsage: result.usage
        ? {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          }
        : null,
      recorded,
    }),
  );
}

export function wrapProviderWithUsageTracking(
  provider: ProviderClient,
  tracker: LlmUsageTracker,
  modelId: string,
): ProviderClient {
  function recordChat(input: GenerateChatInput, result: ChatCompletionResult): void {
    const source = result.usage ? "provider" : "estimate";
    const inputTokens = result.usage?.inputTokens ?? estimateChatInputTokens(input);
    const outputTokens = result.usage?.outputTokens ?? estimateChatOutputTokens(result);
    dumpChatTokenDebug(modelId, input, result, { inputTokens, outputTokens, source });
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
      if (isTokenDebugEnabled()) {
        console.info(
          "[nakama:tokens]",
          JSON.stringify({
            modelId,
            kind: "text",
            estimate: {
              systemTokens: estimateTokens(input.system),
              promptTokens: estimateTokens(input.prompt),
              totalEstimatedInputTokens: estimateTextInputTokens(input),
            },
            providerUsage: result.usage
              ? {
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  totalTokens: result.usage.totalTokens,
                }
              : null,
            recorded: {
              inputTokens,
              outputTokens,
              source: result.usage ? "provider" : "estimate",
            },
          }),
        );
      }
      tracker.record(modelId, inputTokens, outputTokens);
      return result;
    },
  };
}
