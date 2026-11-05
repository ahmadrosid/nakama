import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import { client } from "@/lib/client";
import { validateBaseUrlInput } from "@/lib/models";
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
  addedIds?: ReadonlySet<string>;
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

function browseStatus(
  state: { canFetch: boolean; error: Error | null; loading: boolean },
  count: number,
  label: string,
  addedCount: number
): string {
  if (!state.canFetch) {
    return `Browse models from ${label}`;
  }

  if (state.loading) {
    return `Loading models from ${label}…`;
  }

  if (state.error) {
    return "Could not load models";
  }

  const found = `${count} model${count === 1 ? "" : "s"} from ${label}`;

  return addedCount > 0 ? `${found} · ${addedCount} in your list` : found;
}

export function RemoteModelsBrowseList({
  addedIds,
  onSelect,
  className,
  providerId,
  baseUrl,
  apiKey = "",
  provider,
  hostMode,
  browseLabel = "this endpoint",
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

  const canFetch = Boolean(
    providerId?.trim() ||
      provider === "netra" ||
      (trimmedBaseUrl && validateBaseUrlInput(trimmedBaseUrl) === null)
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    enabled: canFetch,
    queryFn: async () => {
      // When providerId is set, still forward baseUrl so Edit provider can probe a
      // typed (unsaved) URL while the server resolves stored credentials via id.
      const trimmedProviderId = providerId?.trim();

      const request: Parameters<typeof client.discoverModels>[0] =
        trimmedProviderId
          ? { providerId: trimmedProviderId }
          : { apiKey, baseUrl: trimmedBaseUrl };

      if (trimmedProviderId && trimmedBaseUrl) {
        request.baseUrl = trimmedBaseUrl;
      }

      if (trimmedProviderId && apiKey.trim()) {
        request.apiKey = apiKey;
      }

      if (provider) {
        request.provider = provider;
      }

      if (hostMode) {
        request.hostMode = hostMode;
      }

      const response = await client.discoverModels(request);

      return (response.customModels ?? response.models ?? []).map((entry) => {
        const row: RemoteModelRow = {
          id: entry.id,
          name: entry.name?.trim() || entry.id,
        };

        if (entry.supportsThinking !== undefined) {
          row.supportsThinking = entry.supportsThinking;
        }

        if (entry.supportsVision !== undefined) {
          row.supportsVision = entry.supportsVision;
        }

        return row;
      });
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

  // An endpoint that refuses an empty key needs a key, not a different one.
  const browseError =
    error &&
    !(providerId?.trim() || apiKey.trim()) &&
    /rejected this API key/i.test(error.message)
      ? new Error("This endpoint needs an API key. Enter it above.")
      : error;

  return (
    <CatalogModelsBrowseList<RemoteModelRow>
      addedIds={addedIds}
      className={className}
      emptyMessage={`No models found on ${browseLabel}.`}
      idleMessage="Enter a base URL before browsing models."
      multiSelect={multiSelect}
      onAddMany={onAddMany}
      onSelect={onSelect}
      query={{
        canFetch,
        error: browseError,
        isFetching,
        isLoading,
        onRefresh: () => void refetch(),
        refreshDisabled: isFetching,
      }}
      rows={data ?? EMPTY_ROWS}
      status={({ filteredCount }) =>
        browseStatus(
          { canFetch, error: browseError, loading: isLoading || isFetching },
          filteredCount,
          browseLabel,
          addedIds?.size ?? 0
        )
      }
    />
  );
}
