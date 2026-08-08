import type { CustomModelEntry } from "@nakama/core/contract";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CapabilityBrowseRow } from "@/components/model-browse-utils";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const FIREWORKS_FALLBACK_ROWS: CapabilityBrowseRow[] = [
  {
    contextLength: 262_144,
    description: "Reasoning-focused Kimi model on Fireworks serverless.",
    id: "accounts/fireworks/models/kimi-k2p6",
    inputPerMillionUsd: 0.6,
    name: "Kimi K2.6",
    outputPerMillionUsd: 2.5,
    reasoning: true,
    tools: true,
    vision: false,
  },
  {
    contextLength: 131_072,
    description: "Strong coding and reasoning on Fireworks serverless.",
    id: "accounts/fireworks/models/glm-5p2",
    inputPerMillionUsd: 0.55,
    name: "GLM 5.2",
    outputPerMillionUsd: 2.19,
    reasoning: true,
    tools: true,
    vision: false,
  },
  {
    contextLength: 131_072,
    description: "Open-weight reasoning model on Fireworks serverless.",
    id: "accounts/fireworks/models/gpt-oss-120b",
    inputPerMillionUsd: 0.15,
    name: "GPT OSS 120B",
    outputPerMillionUsd: 0.6,
    reasoning: true,
    tools: true,
    vision: false,
  },
  {
    contextLength: 262_144,
    description: "Multimodal Kimi model with vision on Fireworks serverless.",
    id: "accounts/fireworks/models/kimi-k2p5",
    inputPerMillionUsd: 0.6,
    name: "Kimi K2.5",
    outputPerMillionUsd: 2.5,
    reasoning: true,
    tools: true,
    vision: true,
  },
];

function fireworksEntryToCapabilityRow(
  entry: CustomModelEntry
): CapabilityBrowseRow {
  const fallback = FIREWORKS_FALLBACK_ROWS.find((row) => row.id === entry.id);

  return {
    contextLength: fallback?.contextLength,
    description: fallback?.description,
    id: entry.id,
    name:
      entry.name?.trim() ||
      fallback?.name ||
      entry.id.split("/").pop() ||
      entry.id,
    reasoning: entry.supportsThinking === true || fallback?.reasoning === true,
    tools: fallback?.tools ?? true,
    vision: entry.supportsVision === true || fallback?.vision === true,
    ...(entry.inputPerMillionUsd === undefined
      ? fallback?.inputPerMillionUsd === undefined
        ? {}
        : { inputPerMillionUsd: fallback.inputPerMillionUsd }
      : { inputPerMillionUsd: entry.inputPerMillionUsd }),
    ...(entry.outputPerMillionUsd === undefined
      ? fallback?.outputPerMillionUsd === undefined
        ? {}
        : { outputPerMillionUsd: fallback.outputPerMillionUsd }
      : { outputPerMillionUsd: entry.outputPerMillionUsd }),
  };
}

async function fetchFireworksDiscoverRows(options: {
  providerId?: string;
  apiKey?: string;
}): Promise<{ rows: CapabilityBrowseRow[]; usedFallback: boolean }> {
  const providerId = options.providerId?.trim();
  const apiKey = options.apiKey?.trim() ?? "";

  try {
    const response = await client.discoverModels(
      providerId
        ? { providerId }
        : {
            apiKey,
            provider: "fireworks",
          }
    );

    const rows = (response.customModels ?? [])
      .map(fireworksEntryToCapabilityRow)
      .sort((left, right) => left.name.localeCompare(right.name));

    if (rows.length === 0) {
      return { rows: FIREWORKS_FALLBACK_ROWS, usedFallback: true };
    }

    return { rows, usedFallback: false };
  } catch {
    return { rows: FIREWORKS_FALLBACK_ROWS, usedFallback: true };
  }
}

export function fireworksDiscoverQueryOptions(options: {
  providerId?: string;
  apiKey?: string;
}) {
  const providerId = options.providerId?.trim() ?? "";
  const apiKey = options.apiKey?.trim() ?? "";

  return queryOptions({
    enabled: Boolean(providerId || apiKey),
    queryFn: () => fetchFireworksDiscoverRows(options),
    queryKey: queryKeys.remoteModelDiscovery({
      apiKey: apiKey ? "set" : "",
      provider: "fireworks",
      providerId,
    }),
    staleTime: 1000 * 60 * 30,
  });
}

export function useFireworksDiscoverModels(options: {
  providerId?: string;
  apiKey?: string;
}) {
  return useQuery(fireworksDiscoverQueryOptions(options));
}
