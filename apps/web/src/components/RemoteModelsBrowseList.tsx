import type { CustomModelEntry } from "@nakama/core";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BrowseModelRowButton,
  ModelBrowseShell,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import {
  formatBrowseCapabilities,
  type CapabilityBrowseRow,
} from "@/components/model-browse-utils";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export interface RemoteModelRow {
  id: string;
  name: string;
}

export type RemoteBrowseSelectHandler = (row: RemoteModelRow | CapabilityBrowseRow) => void;

const EMPTY_ROWS: RemoteModelRow[] = [];
const EMPTY_CAPABILITY_ROWS: CapabilityBrowseRow[] = [];

const FIREWORKS_FALLBACK_ROWS: CapabilityBrowseRow[] = [
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

interface RemoteModelsBrowseListProps {
  onSelect: RemoteBrowseSelectHandler;
  className?: string;
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
  provider?: "ollama" | "openai_compatible" | "fireworks";
  hostMode?: "local" | "cloud";
  browseLabel?: string;
}

export function RemoteModelsBrowseList({
  onSelect,
  className,
  providerId,
  baseUrl,
  apiKey = "",
  provider,
  hostMode,
  browseLabel = "endpoint",
}: RemoteModelsBrowseListProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [hideDeprecated, setHideDeprecated] = useState(true);
  const trimmedBaseUrl = baseUrl?.trim() ?? "";
  const trimmedApiKey = apiKey.trim();
  const isFireworks = provider === "fireworks";
  const canFetch = isFireworks
    ? Boolean(providerId?.trim() || trimmedApiKey)
    : Boolean(providerId?.trim() || trimmedBaseUrl);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.remoteModelDiscovery({
      providerId,
      baseUrl: trimmedBaseUrl,
      provider,
      hostMode,
      apiKey: trimmedApiKey ? "set" : "",
    }),
    queryFn: async () => {
      if (isFireworks) {
        try {
          const response = await client.discoverModels(
            providerId?.trim()
              ? { providerId: providerId.trim() }
              : {
                  provider: "fireworks",
                  apiKey: trimmedApiKey,
                },
          );

          const entries = response.customModels ?? [];
          const rows = entries
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

      const response = await client.discoverModels(
        providerId?.trim()
          ? { providerId: providerId.trim() }
          : {
              baseUrl: trimmedBaseUrl,
              apiKey,
              ...(provider ? { provider } : {}),
              ...(hostMode ? { hostMode } : {}),
            },
      );

      const rows: RemoteModelRow[] = (response.customModels ?? response.models ?? []).map(
        (entry) => ({
          id: entry.id,
          name: entry.name?.trim() || entry.id,
        }),
      );

      return { rows, usedFallback: false };
    },
    enabled: canFetch,
    staleTime: isFireworks ? 1000 * 60 * 30 : 1000 * 30,
  });

  const rows = data?.rows ?? (isFireworks ? EMPTY_CAPABILITY_ROWS : EMPTY_ROWS);
  const usedFallback = data?.usedFallback ?? false;

  const filtered = useMemo(() => {
    let result = rows;
    if (isFireworks) {
      result = (result as CapabilityBrowseRow[]).filter(
        (row) => !hideDeprecated || !row.deprecated,
      );
    }

    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return result;
    }

    return result.filter((row) => {
      if ("description" in row && row.description) {
        return (
          row.name.toLowerCase().includes(query) ||
          row.id.toLowerCase().includes(query) ||
          row.description.toLowerCase().includes(query)
        );
      }

      return (
        row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query)
      );
    });
  }, [rows, hideDeprecated, deferredSearch, isFireworks]);

  const emptyMessage = isFireworks
    ? "Enter an API key to browse Fireworks models."
    : !canFetch
      ? "Enter a base URL before browsing models."
      : `No models found on this ${browseLabel}.`;

  const status = isFireworks ? (
    canFetch
      ? `${filtered.length} models${usedFallback ? " · using curated fallback catalog" : ""}`
      : emptyMessage
  ) : (
    <div className="flex items-center justify-between gap-2">
      <span>
        {canFetch
          ? `${filtered.length} model${filtered.length === 1 ? "" : "s"} from ${browseLabel}`
          : `Browse models from your ${browseLabel}`}
      </span>
      <button
        type="button"
        className="text-foreground underline-offset-2 hover:underline disabled:opacity-50"
        disabled={!canFetch || isFetching}
        onClick={() => void refetch()}
      >
        Refresh
      </button>
    </div>
  );

  return (
    <ModelBrowseShell
      className={className}
      isLoading={canFetch && (isLoading || (isFetching && rows.length === 0))}
      error={canFetch ? error : null}
      isEmpty={!canFetch || filtered.length === 0}
      emptyMessage={emptyMessage}
      status={status}
      toolbar={
        <>
          <Input
            placeholder="Search model name or ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-35 flex-1"
            disabled={!canFetch}
          />
          {isFireworks ? (
            <label className="flex h-8 cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={hideDeprecated}
                onChange={(event) => setHideDeprecated(event.target.checked)}
                disabled={!canFetch}
              />
              Hide deprecated
            </label>
          ) : null}
        </>
      }
    >
      <VirtualModelBrowseList
        rows={filtered}
        getKey={(row) => row.id}
        renderRow={(row, style) =>
          isFireworks ? (
            <BrowseModelRowButton
              row={{
                id: row.id,
                name: row.name,
                description: (row as CapabilityBrowseRow).description,
                contextLength: (row as CapabilityBrowseRow).contextLength,
                badges: [
                  ...((row as CapabilityBrowseRow).deprecated
                    ? [{ label: "deprecated", tone: "amber" as const }]
                    : []),
                ],
                capabilities: formatBrowseCapabilities(row as CapabilityBrowseRow),
              }}
              onSelect={() => onSelect(row)}
              style={style}
            />
          ) : (
            <BrowseModelRowButton
              row={{ id: row.id, name: row.name }}
              onSelect={() => onSelect(row)}
              style={style}
            />
          )
        }
      />
    </ModelBrowseShell>
  );
}

export { FIREWORKS_FALLBACK_ROWS };
