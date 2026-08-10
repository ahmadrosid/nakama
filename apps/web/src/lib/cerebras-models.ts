export interface CerebrasApiPricing {
  completion?: string;
  prompt?: string;
}

export interface CerebrasApiCapabilities {
  function_calling?: boolean;
  json_mode?: boolean;
  reasoning?: boolean;
  streaming?: boolean;
  structured_outputs?: boolean;
  tools?: boolean;
  vision?: boolean;
}

export interface CerebrasApiModel {
  capabilities?: CerebrasApiCapabilities;
  deprecated?: boolean;
  description?: string;
  id: string;
  limits?: {
    max_context_length?: number;
    max_completion_tokens?: number;
  };
  name: string;
  preview?: boolean;
  pricing?: CerebrasApiPricing;
}

export interface CerebrasModelsApiResponse {
  data?: CerebrasApiModel[];
  object?: string;
}

export interface CerebrasModelRow {
  contextLength: number;
  deprecated: boolean;
  description: string;
  id: string;
  inputPerMillionUsd?: number;
  name: string;
  outputPerMillionUsd?: number;
  preview: boolean;
  reasoning: boolean;
  tools: boolean;
  vision: boolean;
}

export const CEREBRAS_MODELS_URL = "https://api.cerebras.ai/public/v1/models";

export const CEREBRAS_FALLBACK_MODELS: CerebrasModelRow[] = [
  {
    contextLength: 131_072,
    deprecated: false,
    description: "Efficient reasoning across science, math, and coding.",
    id: "gpt-oss-120b",
    inputPerMillionUsd: 0.35,
    name: "OpenAI GPT OSS",
    outputPerMillionUsd: 0.75,
    preview: false,
    reasoning: true,
    tools: true,
    vision: false,
  },
  {
    contextLength: 131_072,
    deprecated: false,
    description: "Multimodal reasoning across screenshots and documents.",
    id: "gemma-4-31b",
    inputPerMillionUsd: 0.99,
    name: "Gemma 4 31B",
    outputPerMillionUsd: 1.49,
    preview: false,
    reasoning: true,
    tools: true,
    vision: true,
  },
  {
    contextLength: 131_072,
    deprecated: false,
    description: "Strong coding performance with advanced reasoning.",
    id: "zai-glm-4.7",
    inputPerMillionUsd: 2.25,
    name: "Z.ai GLM 4.7",
    outputPerMillionUsd: 2.75,
    preview: true,
    reasoning: true,
    tools: true,
    vision: false,
  },
];

export function cerebrasPricingPerMillion(
  pricing: CerebrasApiPricing | undefined
):
  | Pick<CerebrasModelRow, "inputPerMillionUsd" | "outputPerMillionUsd">
  | undefined {
  if (!(pricing?.prompt && pricing?.completion)) {
    return;
  }

  const inputPerMillionUsd = Number.parseFloat(pricing.prompt) * 1_000_000;
  const outputPerMillionUsd = Number.parseFloat(pricing.completion) * 1_000_000;

  if (
    !(
      Number.isFinite(inputPerMillionUsd) &&
      Number.isFinite(outputPerMillionUsd)
    )
  ) {
    return;
  }

  return { inputPerMillionUsd, outputPerMillionUsd };
}

function truncateDescription(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }

  return `${trimmed.slice(0, 157)}...`;
}

export function normalizeCerebrasModel(
  entry: CerebrasApiModel
): CerebrasModelRow {
  const capabilities = entry.capabilities ?? {};
  const perMillion = cerebrasPricingPerMillion(entry.pricing);

  return {
    contextLength: entry.limits?.max_context_length ?? 0,
    deprecated: entry.deprecated === true,
    description: truncateDescription(entry.description ?? ""),
    id: entry.id,
    name: entry.name,
    preview: entry.preview === true,
    reasoning: capabilities.reasoning === true,
    tools:
      capabilities.tools === true || capabilities.function_calling === true,
    vision: capabilities.vision === true,
    ...(perMillion ?? {}),
  };
}

export function normalizeCerebrasModels(
  apiJson: CerebrasModelsApiResponse
): CerebrasModelRow[] {
  const data = apiJson.data ?? [];
  return data.map(normalizeCerebrasModel).sort(compareCerebrasModelRows);
}

export function compareCerebrasModelRows(
  a: CerebrasModelRow,
  b: CerebrasModelRow
): number {
  return a.name.localeCompare(b.name);
}
