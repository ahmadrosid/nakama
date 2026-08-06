export interface CerebrasApiPricing {
  prompt?: string;
  completion?: string;
}

export interface CerebrasApiCapabilities {
  streaming?: boolean;
  function_calling?: boolean;
  structured_outputs?: boolean;
  vision?: boolean;
  json_mode?: boolean;
  tools?: boolean;
  reasoning?: boolean;
}

export interface CerebrasApiModel {
  id: string;
  name: string;
  description?: string;
  pricing?: CerebrasApiPricing;
  capabilities?: CerebrasApiCapabilities;
  limits?: {
    max_context_length?: number;
    max_completion_tokens?: number;
  };
  deprecated?: boolean;
  preview?: boolean;
}

export interface CerebrasModelsApiResponse {
  object?: string;
  data?: CerebrasApiModel[];
}

export interface CerebrasModelRow {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  deprecated: boolean;
  preview: boolean;
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export const CEREBRAS_MODELS_URL = "https://api.cerebras.ai/public/v1/models";

export const CEREBRAS_FALLBACK_MODELS: CerebrasModelRow[] = [
  {
    id: "gpt-oss-120b",
    name: "OpenAI GPT OSS",
    description: "Efficient reasoning across science, math, and coding.",
    contextLength: 131_072,
    deprecated: false,
    preview: false,
    vision: false,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 0.35,
    outputPerMillionUsd: 0.75,
  },
  {
    id: "gemma-4-31b",
    name: "Gemma 4 31B",
    description: "Multimodal reasoning across screenshots and documents.",
    contextLength: 131_072,
    deprecated: false,
    preview: false,
    vision: true,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 0.99,
    outputPerMillionUsd: 1.49,
  },
  {
    id: "zai-glm-4.7",
    name: "Z.ai GLM 4.7",
    description: "Strong coding performance with advanced reasoning.",
    contextLength: 131_072,
    deprecated: false,
    preview: true,
    vision: false,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 2.25,
    outputPerMillionUsd: 2.75,
  },
];

export function cerebrasPricingPerMillion(
  pricing: CerebrasApiPricing | undefined,
): Pick<CerebrasModelRow, "inputPerMillionUsd" | "outputPerMillionUsd"> | undefined {
  if (!pricing?.prompt || !pricing?.completion) {
    return undefined;
  }

  const inputPerMillionUsd = parseFloat(pricing.prompt) * 1_000_000;
  const outputPerMillionUsd = parseFloat(pricing.completion) * 1_000_000;

  if (!Number.isFinite(inputPerMillionUsd) || !Number.isFinite(outputPerMillionUsd)) {
    return undefined;
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

export function normalizeCerebrasModel(entry: CerebrasApiModel): CerebrasModelRow {
  const capabilities = entry.capabilities ?? {};
  const perMillion = cerebrasPricingPerMillion(entry.pricing);

  return {
    id: entry.id,
    name: entry.name,
    description: truncateDescription(entry.description ?? ""),
    contextLength: entry.limits?.max_context_length ?? 0,
    deprecated: entry.deprecated === true,
    preview: entry.preview === true,
    vision: capabilities.vision === true,
    tools: capabilities.tools === true || capabilities.function_calling === true,
    reasoning: capabilities.reasoning === true,
    ...(perMillion ?? {}),
  };
}

export function normalizeCerebrasModels(
  apiJson: CerebrasModelsApiResponse,
): CerebrasModelRow[] {
  const data = apiJson.data ?? [];
  return data.map(normalizeCerebrasModel).sort(compareCerebrasModelRows);
}

export function compareCerebrasModelRows(a: CerebrasModelRow, b: CerebrasModelRow): number {
  return a.name.localeCompare(b.name);
}
