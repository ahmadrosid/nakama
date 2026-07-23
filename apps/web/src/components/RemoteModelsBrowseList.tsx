import { useQuery } from "@tanstack/react-query";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export interface RemoteModelRow {
  id: string;
  name: string;
}

export type RemoteBrowseSelectHandler = (row: RemoteModelRow) => void;

const EMPTY_ROWS: RemoteModelRow[] = [];

interface RemoteModelsBrowseListProps {
  onSelect: RemoteBrowseSelectHandler;
  className?: string;
  providerId?: string;
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

      return (response.customModels ?? response.models ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name?.trim() || entry.id,
      }));
    },
    enabled: canFetch,
    staleTime: 1000 * 30,
  });

  return (
    <CatalogModelsBrowseList<RemoteModelRow>
      rows={data ?? EMPTY_ROWS}
      onSelect={onSelect}
      className={className}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      canFetch={canFetch}
      idleMessage="Enter a base URL before browsing models."
      emptyMessage={`No models found on this ${browseLabel}.`}
      onRefresh={() => void refetch()}
      refreshDisabled={isFetching}
      status={({ filteredCount }) =>
        canFetch
          ? `${filteredCount} model${filteredCount === 1 ? "" : "s"} from ${browseLabel}`
          : `Browse models from your ${browseLabel}`
      }
    />
  );
}
