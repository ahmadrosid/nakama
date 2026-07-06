import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { SelectedProvider } from "@/lib/models";

export interface ModelsDevRow {
  providerId: string;
  providerName: string;
  apiUrl: string;
  modelId: string;
  modelName: string;
  isFree: boolean;
  deprecated: boolean;
  context: number;
  toolCall: boolean;
  reasoning: boolean;
  vision: boolean;
  isZen: boolean;
  nakamaProvider: SelectedProvider;
  supported: boolean;
  unsupportedReason?: string;
  experimental: boolean;
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
  "@ai-sdk/openai": "openai",
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "gemini",
};

const PROVIDER_ID_OVERRIDES: Record<string, SelectedProvider> = {
  openrouter: "openrouter",
  opencode: "openai_compatible",
  deepseek: "deepseek",
};

const UNSUPPORTED_NPM: Record<string, string> = {
  "@ai-sdk/amazon-bedrock": "Requires AWS SigV4 auth",
  "@ai-sdk/azure": "Requires Azure deployment routing",
  "@ai-sdk/google-vertex": "Requires Google Cloud OAuth",
  "@ai-sdk/google-vertex/anthropic": "Requires Google Cloud OAuth",
  "@ai-sdk/gateway": "Requires Vercel AI Gateway",
  "ai-gateway-provider": "Requires Cloudflare AI Gateway",
  "merge-gateway-ai-sdk-provider": "Requires custom gateway auth",
  "@jerome-benoit/sap-ai-provider-v2": "Requires SAP-specific auth",
  "gitlab-ai-provider": "Requires GitLab Duo auth",
  "venice-ai-sdk-provider": "Requires Venice-specific auth",
};

function resolvenakamaProvider(
  providerId: string,
  npm: string | undefined,
): SelectedProvider {
  const override = PROVIDER_ID_OVERRIDES[providerId];
  if (override) return override;
  if (npm && NPM_MAP[npm]) return NPM_MAP[npm];
  return "openai_compatible";
}

async function fetchModelsDev(): Promise<ModelsDevRow[]> {
  const res = await fetch("https://models.dev/api.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as Record<string, unknown>;
  const rows: ModelsDevRow[] = [];

  for (const [providerId, p] of Object.entries(data)) {
    const provider = p as Record<string, unknown>;
    const providerName = (provider.name as string | undefined) ?? providerId;
    const apiUrl = (provider.api as string | undefined) ?? "";
    const npm = provider.npm as string | undefined;
    const models = (provider.models as Record<string, unknown> | undefined) ?? {};
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
      const modalities = (model.modalities as Record<string, string[]> | undefined) ?? {};

      rows.push({
        providerId,
        providerName,
        apiUrl,
        modelId,
        modelName: (model.name as string | undefined) ?? modelId,
        isFree: inputCost === 0 && outputCost === 0,
        deprecated: (model.status as string | undefined) === "deprecated",
        context: (limit.context as number | undefined) ?? 0,
        toolCall: !!(model.tool_call as boolean | undefined),
        reasoning: !!(model.reasoning as boolean | undefined),
        vision: (modalities.input ?? []).includes("image"),
        isZen: providerId === "opencode",
        nakamaProvider,
        supported,
        ...(unsupportedReason ? { unsupportedReason } : {}),
        experimental,
      });
    }
  }

  return rows;
}

export const modelsDevQueryOptions = queryOptions({
  queryKey: queryKeys.modelsDev,
  queryFn: fetchModelsDev,
  staleTime: 1000 * 60 * 30,
});

export function useModelsDev() {
  return useQuery(modelsDevQueryOptions);
}
