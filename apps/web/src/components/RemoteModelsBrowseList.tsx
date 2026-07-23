import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BrowseModelRowButton,
  ModelBrowseShell,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export interface RemoteModelRow {
  id: string;
  name: string;
}

export type RemoteBrowseSelectHandler = (row: RemoteModelRow) => void;

interface RemoteModelsBrowseListProps {
  onSelect: RemoteBrowseSelectHandler;
  className?: string;
  /** Existing provider instance — preferred when editing/managing. */
  providerId?: string;
  /** Used when creating a provider (no instance yet). */
  baseUrl?: string;
  apiKey?: string;
  provider?: "ollama" | "openai_compatible";
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
  const trimmedBaseUrl = baseUrl?.trim() ?? "";
  const canFetch = Boolean(providerId?.trim() || trimmedBaseUrl);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.remoteModelDiscovery({
      providerId,
      baseUrl: trimmedBaseUrl,
      provider,
      hostMode,
      apiKey: apiKey.trim() ? "set" : "",
    }),
    queryFn: async () => {
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

      return rows;
    },
    enabled: canFetch,
    staleTime: 1000 * 30,
  });

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query),
    );
  }, [rows, deferredSearch]);

  return (
    <ModelBrowseShell
      className={className}
      isLoading={isLoading || (isFetching && rows.length === 0)}
      error={
        !canFetch
          ? "Enter a base URL before browsing models."
          : error
            ? error instanceof Error
              ? error.message
              : String(error)
            : null
      }
      isEmpty={filtered.length === 0}
      emptyMessage={`No models found on this ${browseLabel}.`}
      status={
        <div className="flex items-center justify-between gap-2">
          <span>
            {filtered.length} model{filtered.length === 1 ? "" : "s"} from {browseLabel}
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
      }
      toolbar={
        <Input
          placeholder="Search model name or ID..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-35 flex-1"
          disabled={!canFetch}
        />
      }
    >
      <VirtualModelBrowseList
        rows={filtered}
        getKey={(row) => row.id}
        renderRow={(row, style) => (
          <BrowseModelRowButton
            row={{ id: row.id, name: row.name }}
            onSelect={() => onSelect(row)}
            style={style}
          />
        )}
      />
    </ModelBrowseShell>
  );
}
