import { ThinkingLevel, type GenerateContentConfig, type Tool } from "@google/genai";
import type {
  GenerateChatInput,
  LlmToolDefinition,
  ProviderChatOptions,
  ThinkingEffort,
} from "@nakama/core";
import { normalizeThinkingEffort } from "../shared";

export function buildGeminiGenerateConfig(options: {
  system: string;
  tools?: LlmToolDefinition[];
  providerOptions?: ProviderChatOptions;
  model: string;
  responseMimeType?: string;
}): GenerateContentConfig {
  const tools = buildGeminiTools(options.tools, options.providerOptions?.webSearch ?? false);
  const thinkingConfig = buildGeminiThinkingConfig(
    options.model,
    options.providerOptions,
  );

  return {
    systemInstruction: options.system,
    ...(options.responseMimeType
      ? { responseMimeType: options.responseMimeType }
      : {}),
    ...(tools ? { tools } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };
}

function buildGeminiTools(
  tools: LlmToolDefinition[] | undefined,
  webSearch: boolean,
): Tool[] | undefined {
  const result: Tool[] = [];

  if (webSearch) {
    result.push({ googleSearch: {} });
  }

  if (tools?.length) {
    result.push({
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    });
  }

  return result.length > 0 ? result : undefined;
}

function buildGeminiThinkingConfig(
  model: string,
  providerOptions: ProviderChatOptions | undefined,
): GenerateContentConfig["thinkingConfig"] {
  const enabled = providerOptions?.thinking?.enabled ?? false;

  if (!enabled) {
    if (model.includes("flash")) {
      return { thinkingBudget: 0 };
    }

    return undefined;
  }

  const effort = normalizeThinkingEffort(providerOptions?.thinking?.effort);

  if (model.includes("gemini-3") || model.includes("3-")) {
    return {
      includeThoughts: true,
      thinkingLevel: mapEffortToThinkingLevel(effort),
    };
  }

  return {
    includeThoughts: true,
    thinkingBudget: mapEffortToThinkingBudget(effort),
  };
}

function mapEffortToThinkingLevel(effort: ThinkingEffort): ThinkingLevel {
  if (effort === "low") {
    return ThinkingLevel.LOW;
  }

  if (effort === "high") {
    return ThinkingLevel.HIGH;
  }

  return ThinkingLevel.MEDIUM;
}

function mapEffortToThinkingBudget(effort: ThinkingEffort): number {
  if (effort === "low") {
    return 1024;
  }

  if (effort === "high") {
    return 8192;
  }

  return 4096;
}

export function buildGeminiChatConfig(
  input: Pick<GenerateChatInput, "tools" | "providerOptions">,
  system: string,
  model: string,
): GenerateContentConfig {
  return buildGeminiGenerateConfig({
    system,
    tools: input.tools,
    providerOptions: input.providerOptions,
    model,
  });
}
