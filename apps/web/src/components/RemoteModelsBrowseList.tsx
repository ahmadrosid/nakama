import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export interface RemoteModelRow {
  id: string;
  name: string;
  supportsThinking?: boolean;
  supportsVision?: boolean;
}

type RemoteBrowseSelectHandler = (row: RemoteModelRow) => void;

const EMPTY_ROWS: RemoteModelRow[] = [];

interface RemoteModelsBrowseListProps {
  apiKey?: string;
  baseUrl?: string;
  browseLabel?: string;
  className?: string;
  hostMode?: "local" | "cloud";
  multiSelect?: boolean;
  onAddMany?: (rows: RemoteModelRow[]) => void;
  onSelect: RemoteBrowseSelectHandler;
  provider?: "ollama" | "openai_compatible" | "netra";
  providerId?: string;
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
  multiSelect,
  onAddMany,
}: RemoteModelsBrowseListProps) {
  const credentialCacheKey = useMemo(() => {
    let first = 0;
    let second = 0;
    for (let index = 0; index < apiKey.length; index += 1) {
      first = (first * 31 + apiKey.charCodeAt(index)) % 1_000_000_007;
      second = (second * 37 + apiKey.charCodeAt(index)) % 1_000_000_009;
    }
    return `${apiKey.length}:${first}:${second}`;
  }, [apiKey]);
  const trimmedBaseUrl = baseUrl?.trim() ?? "";
  const canFetch = Boolean(providerId?.trim() || trimmedBaseUrl);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    enabled: canFetch,
    queryFn: async () => {
      // When providerId is set, still forward baseUrl so Edit provider can probe a
      // typed (unsaved) URL while the server resolves stored credentials via id.
      const response = await client.discoverModels(
        providerId?.trim()
          ? {
              providerId: providerId.trim(),
              ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
              ...(apiKey.trim() ? { apiKey } : {}),
              ...(provider ? { provider } : {}),
              ...(hostMode ? { hostMode } : {}),
            }
          : {
              apiKey,
              baseUrl: trimmedBaseUrl,
              ...(provider ? { provider } : {}),
              ...(hostMode ? { hostMode } : {}),
            }
      );

      return (response.customModels ?? response.models ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name?.trim() || entry.id,
        ...(entry.supportsThinking === undefined
          ? {}
          : { supportsThinking: entry.supportsThinking }),
        ...(entry.supportsVision === undefined
          ? {}
          : { supportsVision: entry.supportsVision }),
      }));
    },
    queryKey: queryKeys.remoteModelDiscovery({
      apiKey: credentialCacheKey,
      baseUrl: trimmedBaseUrl,
      hostMode,
      provider,
      providerId,
    }),
    staleTime: 1000 * 30,
  });

  return (
    <CatalogModelsBrowseList<RemoteModelRow>
      className={className}
      emptyMessage={`No models found on this ${browseLabel}.`}
      idleMessage="Enter a base URL before browsing models."
      multiSelect={multiSelect}
      onAddMany={onAddMany}
      onSelect={onSelect}
      query={{
        canFetch,
        error,
        isFetching,
        isLoading,
        onRefresh: () => void refetch(),
        refreshDisabled: isFetching,
      }}
      rows={data ?? EMPTY_ROWS}
      status={({ filteredCount }) =>
        canFetch
          ? `${filteredCount} model${filteredCount === 1 ? "" : "s"} from ${browseLabel}`
          : `Browse models from your ${browseLabel}`
      }
    />
  );
}
