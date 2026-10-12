import { queryOptions, useQuery } from "@tanstack/react-query";
import { client } from "@/lib/client";
import type { SelectedProvider } from "@/lib/models";
import { queryKeys } from "@/lib/query-keys";

export interface ModelsDevRow {
  apiUrl: string;
  context: number;
  deprecated: boolean;
  experimental: boolean;
  isFree: boolean;
  isZen: boolean;
  modelId: string;
  modelName: string;
  nakamaProvider: SelectedProvider;
  providerId: string;
  providerName: string;
  reasoning: boolean;
  supported: boolean;
  toolCall: boolean;
  unsupportedReason?: string;
  vision: boolean;
}

const OFFICIAL_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "opencode",
  "deepseek",
  "doubao",
  "together",
  "mistral",
  "alibaba",
  "qwen",
  "perplexity",
]);

// oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
const NPM_MAP: Record<string, SelectedProvider> = {
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/gateway": "vercel_ai_gateway",
  "@ai-sdk/google": "gemini",
  "@ai-sdk/openai": "openai",
};

// oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
const PROVIDER_ID_OVERRIDES: Record<string, SelectedProvider> = {
  alibaba: "qwen",
  bytedance: "doubao",
  deepseek: "deepseek",
  mistral: "mistral",
  opencode: "openai_compatible",
  openrouter: "openrouter",
  perplexity: "perplexity",
  qwen: "qwen",
  together: "together",
  vercel: "vercel_ai_gateway",
  volcengine: "doubao",
  xiaomi: "xiaomi",
};

// oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
const UNSUPPORTED_NPM: Record<string, string> = {
  "@ai-sdk/amazon-bedrock": "Requires AWS SigV4 auth",
  "@ai-sdk/azure": "Requires Azure deployment routing",
  "@ai-sdk/google-vertex": "Requires Google Cloud OAuth",
  "@ai-sdk/google-vertex/anthropic": "Requires Google Cloud OAuth",
  "@jerome-benoit/sap-ai-provider-v2": "Requires SAP-specific auth",
  "ai-gateway-provider": "Requires Cloudflare AI Gateway",
  "gitlab-ai-provider": "Requires GitLab Duo auth",
  "merge-gateway-ai-sdk-provider": "Requires custom gateway auth",
  "venice-ai-sdk-provider": "Requires Venice-specific auth",
};

function resolvenakamaProvider(
  providerId: string,
  npm: string | undefined
): SelectedProvider {
  const override = PROVIDER_ID_OVERRIDES[providerId];

  if (override) {
    return override;
  }

  if (npm && NPM_MAP[npm]) {
    return NPM_MAP[npm];
  }

  return "openai_compatible";
}

async function fetchModelsDev(): Promise<ModelsDevRow[]> {
  return parseModelsDevCatalog(
    // SAFETY: The enclosing parser checks the value before this conversion.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
    (await client.getExternalModelCatalog("models-dev")) as Record<
      string,
      unknown
    >
  );
}

export function parseModelsDevCatalog(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  data: Record<string, unknown>
): ModelsDevRow[] {
  const rows: ModelsDevRow[] = [];

  for (const [providerId, p] of Object.entries(data)) {
    // SAFETY: The enclosing parser checks the value before this conversion.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
    const provider = p as Record<string, unknown>;
    // SAFETY: The enclosing parser checks the value before this conversion.
    const providerName = (provider.name as string | undefined) ?? providerId;
    // SAFETY: The enclosing parser checks the value before this conversion.
    const apiUrl = (provider.api as string | undefined) ?? "";
    // SAFETY: The enclosing parser checks the value before this conversion.
    const npm = provider.npm as string | undefined;

    const models =
      // SAFETY: The enclosing parser checks the value before this conversion.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
      (provider.models as Record<string, unknown> | undefined) ?? {};

    const nakamaProvider = resolvenakamaProvider(providerId, npm);
    const providerUnsupportedReason = npm ? UNSUPPORTED_NPM[npm] : undefined;

    const experimental = !(
      providerUnsupportedReason || OFFICIAL_PROVIDER_IDS.has(providerId)
    );

    for (const [modelId, m] of Object.entries(models)) {
      // SAFETY: The enclosing parser checks the value before this conversion.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
      const model = m as Record<string, unknown>;
      // SAFETY: The enclosing parser checks the value before this conversion.
      const cost = model.cost as Record<string, number> | number | undefined;
      let inputCost: number | undefined;
      let outputCost: number | undefined;

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
      if (typeof cost === "object" && cost !== null) {
        inputCost = cost.input;
        outputCost = cost.output;
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
      } else if (typeof cost === "number") {
        inputCost = outputCost = cost;
      }

      // SAFETY: The enclosing parser checks the value before this conversion.
      const limit = (model.limit as Record<string, number> | undefined) ?? {};

      const modalities =
        // SAFETY: The enclosing parser checks the value before this conversion.
        (model.modalities as Record<string, string[]> | undefined) ?? {};

      const inputModalities = new Set(modalities.input ?? []);
      const isFree = inputCost === 0 && outputCost === 0;

      // OpenCode rejects its free tier from any other client, with or without a key.
      const unsupportedReason =
        providerUnsupportedReason ??
        (providerId === "opencode" && isFree
          ? "OpenCode's free tier only works inside OpenCode"
          : undefined);

      rows.push({
        apiUrl,
        // SAFETY: The enclosing parser checks the value before this conversion.
        context: (limit.context as number | undefined) ?? 0,
        // SAFETY: The enclosing parser checks the value before this conversion.
        deprecated: (model.status as string | undefined) === "deprecated",
        isFree,
        isZen: providerId === "opencode",
        modelId,
        // SAFETY: The enclosing parser checks the value before this conversion.
        modelName: (model.name as string | undefined) ?? modelId,
        nakamaProvider,
        providerId,
        providerName,
        // SAFETY: The enclosing parser checks the value before this conversion.
        reasoning: !!(model.reasoning as boolean | undefined),
        supported: !unsupportedReason,
        // SAFETY: The enclosing parser checks the value before this conversion.
        toolCall: !!(model.tool_call as boolean | undefined),
        vision: inputModalities.has("image"),
        // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
        ...(unsupportedReason ? { unsupportedReason } : {}),
        experimental,
      });
    }
  }

  return rows;
}

const modelsDevQueryOptions = queryOptions({
  queryFn: fetchModelsDev,
  queryKey: queryKeys.modelsDev,
  staleTime: 1000 * 60 * 30,
});

export function useModelsDev() {
  return useQuery(modelsDevQueryOptions);
}
