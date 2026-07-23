import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import type { CapabilityBrowseRow } from "@/components/model-browse-utils";
import {
  capabilityBrowseRowToDisplayRow,
  filterCapabilityBrowseRows,
} from "@/components/model-browse-utils";
import { useFireworksDiscoverModels } from "@/hooks/use-fireworks-discover-models";

export type FireworksBrowseSelectHandler = (row: CapabilityBrowseRow) => void;

interface FireworksModelsBrowseListProps {
  onSelect: FireworksBrowseSelectHandler;
  className?: string;
  apiKey?: string;
  providerId?: string;
}

export function FireworksModelsBrowseList({
  onSelect,
  className,
  apiKey,
  providerId,
}: FireworksModelsBrowseListProps) {
  const canFetch = Boolean(providerId?.trim() || apiKey?.trim());
  const { data, isLoading, error } = useFireworksDiscoverModels({ apiKey, providerId });

  return (
    <CatalogModelsBrowseList<CapabilityBrowseRow>
      rows={data?.rows ?? []}
      onSelect={onSelect}
      className={className}
      isLoading={isLoading}
      error={error}
      canFetch={canFetch}
      idleMessage="Enter an API key to browse Fireworks models."
      isDeprecated={(row) => row.deprecated === true}
      toDisplayRow={capabilityBrowseRowToDisplayRow}
      filterRows={(rows, search, hideDeprecated) =>
        filterCapabilityBrowseRows(rows, { search, hideDeprecated })
      }
      status={({ filteredCount }) =>
        `${filteredCount} models${data?.usedFallback ? " · using curated fallback catalog" : ""}`
      }
    />
  );
}
