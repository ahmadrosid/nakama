import type { CustomModelEntry } from "@nakama/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CapabilityBrowseRow } from "@/components/model-browse-utils";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const FIREWORKS_FALLBACK_ROWS: CapabilityBrowseRow[] = [
  {
    id: "accounts/fireworks/models/kimi-k2p6",
    name: "Kimi K2.6",
    description: "Reasoning-focused Kimi model on Fireworks serverless.",
    contextLength: 262_144,
    vision: false,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 0.6,
    outputPerMillionUsd: 2.5,
  },
  {
    id: "accounts/fireworks/models/glm-5p2",
    name: "GLM 5.2",
    description: "Strong coding and reasoning on Fireworks serverless.",
    contextLength: 131_072,
    vision: false,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 0.55,
    outputPerMillionUsd: 2.19,
  },
  {
    id: "accounts/fireworks/models/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "Open-weight reasoning model on Fireworks serverless.",
    contextLength: 131_072,
    vision: false,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
  },
  {
    id: "accounts/fireworks/models/kimi-k2p5",
    name: "Kimi K2.5",
    description: "Multimodal Kimi model with vision on Fireworks serverless.",
    contextLength: 262_144,
    vision: true,
    tools: true,
    reasoning: true,
    inputPerMillionUsd: 0.6,
    outputPerMillionUsd: 2.5,
  },
];

function fireworksEntryToCapabilityRow(entry: CustomModelEntry): CapabilityBrowseRow {
  const fallback = FIREWORKS_FALLBACK_ROWS.find((row) => row.id === entry.id);

  return {
    id: entry.id,
    name: entry.name?.trim() || fallback?.name || entry.id.split("/").pop() || entry.id,
    description: fallback?.description,
    contextLength: fallback?.contextLength,
    vision: entry.supportsVision === true || fallback?.vision === true,
    tools: fallback?.tools ?? true,
    reasoning: entry.supportsThinking === true || fallback?.reasoning === true,
    ...(entry.inputPerMillionUsd !== undefined
      ? { inputPerMillionUsd: entry.inputPerMillionUsd }
      : fallback?.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: fallback.inputPerMillionUsd }
        : {}),
    ...(entry.outputPerMillionUsd !== undefined
      ? { outputPerMillionUsd: entry.outputPerMillionUsd }
      : fallback?.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: fallback.outputPerMillionUsd }
        : {}),
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
            provider: "fireworks",
            apiKey,
          },
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
    queryKey: queryKeys.remoteModelDiscovery({
      providerId,
      provider: "fireworks",
      apiKey: apiKey ? "set" : "",
    }),
    queryFn: () => fetchFireworksDiscoverRows(options),
    enabled: Boolean(providerId || apiKey),
    staleTime: 1000 * 60 * 30,
  });
}

export function useFireworksDiscoverModels(options: {
  providerId?: string;
  apiKey?: string;
}) {
  return useQuery(fireworksDiscoverQueryOptions(options));
}
