import type { JsonSchema, ProviderClient } from "@nakama/core";
import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.json());

type JsonObject = z.infer<typeof JsonObjectSchema>;

const GenerateTextContentSchema = z.union([
  z.string(),
  z.object({ content: z.string() }).transform(({ content }) => content),
]);

export interface SuggestToolParamsInput {
  description: string;
  parameters?: JsonSchema;
  prompt: string;
  toolName: string;
}

const SUGGEST_PARAMS_SYSTEM = [
  "You generate JSON parameter objects for testing Nakama custom tools.",
  "Return only a valid JSON object matching the tool schema.",
  "Do not use markdown fences, labels, or surrounding prose.",
].join("\n");

function buildSuggestParamsUserPrompt(input: SuggestToolParamsInput): string {
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

export function parseSuggestedParams(raw: string): JsonObject | null {
  const trimmed = raw.trim();

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed = JsonObjectSchema.safeParse(JSON.parse(unfenced));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readGenerateTextContent(
  result: z.input<typeof GenerateTextContentSchema>
): string {
  return GenerateTextContentSchema.parse(result);
}

export async function suggestToolParamsFromPrompt(
  input: SuggestToolParamsInput,
  options: { provider?: ProviderClient }
): Promise<JsonObject> {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  if (!options.provider) {
    return {};
  }

  try {
    const result = await options.provider.generateText({
      format: "text",
      prompt: buildSuggestParamsUserPrompt(input),
      system: SUGGEST_PARAMS_SYSTEM,
    });

    return parseSuggestedParams(readGenerateTextContent(result)) ?? {};
  } catch {
    return {};
  }
}
