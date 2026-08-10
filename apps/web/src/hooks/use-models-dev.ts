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
]);

const NPM_MAP: Record<string, SelectedProvider> = {
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "gemini",
  "@ai-sdk/openai": "openai",
};

const PROVIDER_ID_OVERRIDES: Record<string, SelectedProvider> = {
  deepseek: "deepseek",
  opencode: "openai_compatible",
  openrouter: "openrouter",
};

const UNSUPPORTED_NPM: Record<string, string> = {
  "@ai-sdk/amazon-bedrock": "Requires AWS SigV4 auth",
  "@ai-sdk/azure": "Requires Azure deployment routing",
  "@ai-sdk/gateway": "Requires Vercel AI Gateway",
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
  const data = (await client.getExternalModelCatalog("models-dev")) as Record<
    string,
    unknown
  >;
  const rows: ModelsDevRow[] = [];

  for (const [providerId, p] of Object.entries(data)) {
    const provider = p as Record<string, unknown>;
    const providerName = (provider.name as string | undefined) ?? providerId;
    const apiUrl = (provider.api as string | undefined) ?? "";
    const npm = provider.npm as string | undefined;
    const models =
      (provider.models as Record<string, unknown> | undefined) ?? {};
    const nakamaProvider = resolvenakamaProvider(providerId, npm);
    const unsupportedReason = npm ? UNSUPPORTED_NPM[npm] : undefined;
    const supported = !unsupportedReason;
    const experimental = supported && !OFFICIAL_PROVIDER_IDS.has(providerId);

    for (const [modelId, m] of Object.entries(models)) {
      const model = m as Record<string, unknown>;
      const cost = model.cost as Record<string, number> | number | undefined;
      let inputCost: number | undefined;
      let outputCost: number | undefined;

      if (typeof cost === "object" && cost !== null) {
        inputCost = cost.input;
        outputCost = cost.output;
      } else if (typeof cost === "number") {
        inputCost = outputCost = cost;
      }

      const limit = (model.limit as Record<string, number> | undefined) ?? {};
      const modalities =
        (model.modalities as Record<string, string[]> | undefined) ?? {};

      const inputModalities = new Set(modalities.input ?? []);

      rows.push({
        apiUrl,
        context: (limit.context as number | undefined) ?? 0,
        deprecated: (model.status as string | undefined) === "deprecated",
        isFree: inputCost === 0 && outputCost === 0,
        isZen: providerId === "opencode",
        modelId,
        modelName: (model.name as string | undefined) ?? modelId,
        nakamaProvider,
        providerId,
        providerName,
        reasoning: !!(model.reasoning as boolean | undefined),
        supported,
        toolCall: !!(model.tool_call as boolean | undefined),
        vision: inputModalities.has("image"),
        ...(unsupportedReason ? { unsupportedReason } : {}),
        experimental,
      });
    }
  }

  return rows;
}

export const modelsDevQueryOptions = queryOptions({
  queryFn: fetchModelsDev,
  queryKey: queryKeys.modelsDev,
  staleTime: 1000 * 60 * 30,
});

export function useModelsDev() {
  return useQuery(modelsDevQueryOptions);
}
