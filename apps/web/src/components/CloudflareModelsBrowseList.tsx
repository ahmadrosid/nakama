import type { CustomModelEntry } from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import type { CapabilityBrowseRow } from "@/components/model-browse-utils";
import {
  capabilityBrowseRowToDisplayRow,
  filterCapabilityBrowseRows,
} from "@/components/model-browse-utils";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

interface CloudflareModelsBrowseListProps {
  apiKey?: string;
  /** Workers AI URL for the account, used before the provider is saved. */
  baseUrl?: string;
  className?: string;
  multiSelect?: boolean;
  onAddMany?: (rows: CapabilityBrowseRow[]) => void;
  onSelect: (row: CapabilityBrowseRow) => void;
  providerId?: string;
}

function cloudflareEntryToCapabilityRow(
  entry: CustomModelEntry
): CapabilityBrowseRow {
  return {
    contextLength: entry.contextWindow,
    id: entry.id,
    inputPerMillionUsd: entry.inputPerMillionUsd,
    name: entry.name?.trim() || entry.id,
    outputPerMillionUsd: entry.outputPerMillionUsd,
    vision: entry.supportsVision === true,
  };
}

export function CloudflareModelsBrowseList({
  apiKey,
  baseUrl,
  className,
  multiSelect,
  onAddMany,
  onSelect,
  providerId,
}: CloudflareModelsBrowseListProps) {
  const trimmedProviderId = providerId?.trim() ?? "";
  const trimmedApiKey = apiKey?.trim() ?? "";
  const trimmedBaseUrl = baseUrl?.trim() ?? "";

  const canFetch = Boolean(
    trimmedProviderId || (trimmedApiKey && trimmedBaseUrl)
  );

  const { data, isLoading, error } = useQuery({
    enabled: canFetch,
    queryFn: async () => {
      const response = await client.discoverModels(
        trimmedProviderId
          ? { providerId: trimmedProviderId }
          : {
              apiKey: trimmedApiKey,
              baseUrl: trimmedBaseUrl,
              provider: "cloudflare",
            }
      );

      return (response.customModels ?? []).map(cloudflareEntryToCapabilityRow);
    },
    queryKey: queryKeys.remoteModelDiscovery({
      apiKey: trimmedApiKey ? "set" : "",
      baseUrl: trimmedBaseUrl,
      provider: "cloudflare",
      providerId: trimmedProviderId,
    }),
    staleTime: 1000 * 60 * 30,
  });

  return (
    <CatalogModelsBrowseList<CapabilityBrowseRow>
      className={className}
      filterRows={(rows, search, hideDeprecated) =>
        filterCapabilityBrowseRows(rows, { hideDeprecated, search })
      }
      idleMessage="Enter an API key and account ID to browse Cloudflare models."
      multiSelect={multiSelect}
      onAddMany={onAddMany}
      onSelect={onSelect}
      query={{ canFetch, error, isLoading }}
      rows={data ?? []}
      status={({ filteredCount }) => `${filteredCount} models`}
      toDisplayRow={capabilityBrowseRowToDisplayRow}
    />
  );
}
