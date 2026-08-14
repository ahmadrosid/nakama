import { useQuery } from "@tanstack/react-query";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export interface RemoteModelRow {
  id: string;
  name: string;
  supportsVision?: boolean;
}

export type RemoteBrowseSelectHandler = (row: RemoteModelRow) => void;

const EMPTY_ROWS: RemoteModelRow[] = [];

interface RemoteModelsBrowseListProps {
  apiKey?: string;
  baseUrl?: string;
  browseLabel?: string;
  className?: string;
  hostMode?: "local" | "cloud";
  onSelect: RemoteBrowseSelectHandler;
  provider?: "ollama" | "openai_compatible";
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
}: RemoteModelsBrowseListProps) {
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
        ...(entry.supportsVision === undefined
          ? {}
          : { supportsVision: entry.supportsVision }),
      }));
    },
    queryKey: queryKeys.remoteModelDiscovery({
      apiKey: apiKey.trim() ? "set" : "",
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
