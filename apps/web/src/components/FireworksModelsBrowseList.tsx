import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import type { CapabilityBrowseRow } from "@/components/model-browse-utils";
import {
  capabilityBrowseRowToDisplayRow,
  filterCapabilityBrowseRows,
} from "@/components/model-browse-utils";
import { useFireworksDiscoverModels } from "@/hooks/use-fireworks-discover-models";

type FireworksBrowseSelectHandler = (row: CapabilityBrowseRow) => void;

interface FireworksModelsBrowseListProps {
  apiKey?: string;
  className?: string;
  multiSelect?: boolean;
  onAddMany?: (rows: CapabilityBrowseRow[]) => void;
  onSelect: FireworksBrowseSelectHandler;
  providerId?: string;
}

export function FireworksModelsBrowseList({
  onSelect,
  className,
  apiKey,
  providerId,
  multiSelect,
  onAddMany,
}: FireworksModelsBrowseListProps) {
  const canFetch = Boolean(providerId?.trim() || apiKey?.trim());
  const { data, isLoading, error } = useFireworksDiscoverModels({
    apiKey,
    providerId,
  });

  return (
    <CatalogModelsBrowseList<CapabilityBrowseRow>
      className={className}
      filterRows={(rows, search, hideDeprecated) =>
        filterCapabilityBrowseRows(rows, { hideDeprecated, search })
      }
      idleMessage="Enter an API key to browse Fireworks models."
      isDeprecated={(row) => row.deprecated === true}
      multiSelect={multiSelect}
      onAddMany={onAddMany}
      onSelect={onSelect}
      query={{ canFetch, error, isLoading }}
      rows={data?.rows ?? []}
      status={({ filteredCount }) =>
        `${filteredCount} models${data?.usedFallback ? " · using curated fallback catalog" : ""}`
      }
      toDisplayRow={capabilityBrowseRowToDisplayRow}
    />
  );
}
