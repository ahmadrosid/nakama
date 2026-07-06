import type { JsonSchema, ProviderClient } from "@nakama/core";

export interface SuggestToolParamsInput {
  toolName: string;
  description: string;
  parameters?: JsonSchema;
  prompt: string;
}

const SUGGEST_PARAMS_SYSTEM = [
  "You generate JSON parameter objects for testing Nakama custom tools.",
  "Return only a valid JSON object matching the tool schema.",
  "Do not use markdown fences, labels, or surrounding prose.",
].join("\n");

export function buildSuggestParamsUserPrompt(input: SuggestToolParamsInput): string {
  const lines = [
    `Tool: ${input.toolName}`,
    `Description: ${input.description}`,
    `Test intent: ${input.prompt.trim()}`,
  ];

  if (input.parameters) {
    lines.push(`Parameter schema: ${JSON.stringify(input.parameters)}`);
  }

  return lines.join("\n");
}

export function parseSuggestedParams(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(unfenced);

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function readGenerateTextContent(result: { content: string } | string): string {
  return typeof result === "string" ? result : result.content;
}

export async function suggestToolParamsFromPrompt(
  input: SuggestToolParamsInput,
  options: { provider?: ProviderClient },
): Promise<Record<string, unknown>> {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  if (!options.provider) {
    return {};
  }

  try {
    const result = await options.provider.generateText({
      system: SUGGEST_PARAMS_SYSTEM,
      prompt: buildSuggestParamsUserPrompt(input),
      format: "text",
    });

    return parseSuggestedParams(readGenerateTextContent(result)) ?? {};
  } catch {
    return {};
  }
}
