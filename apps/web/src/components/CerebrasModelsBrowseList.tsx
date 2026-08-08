import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import {
  capabilityBrowseRowToDisplayRow,
  filterCapabilityBrowseRows,
} from "@/components/model-browse-utils";
import { useCerebrasModels } from "@/hooks/use-cerebras-models";
import type { CerebrasModelRow } from "@/lib/cerebras-models";

export type CerebrasBrowseSelectHandler = (row: CerebrasModelRow) => void;

interface CerebrasModelsBrowseListProps {
  className?: string;
  onSelect: CerebrasBrowseSelectHandler;
}

const EMPTY_ROWS: CerebrasModelRow[] = [];

export function CerebrasModelsBrowseList({
  onSelect,
  className,
}: CerebrasModelsBrowseListProps) {
  const { data, isLoading, error } = useCerebrasModels();

  return (
    <CatalogModelsBrowseList<CerebrasModelRow>
      className={className}
      filterRows={(rows, search, hideDeprecated) =>
        filterCapabilityBrowseRows(rows, {
          hideDeprecated,
          search,
        }) as CerebrasModelRow[]
      }
      isDeprecated={(row) => row.deprecated}
      onSelect={onSelect}
      query={{ error, isLoading }}
      rows={data?.rows ?? EMPTY_ROWS}
      status={({ filteredCount }) =>
        `${filteredCount} models${data?.usedFallback ? " · using curated fallback catalog" : ""}`
      }
      toDisplayRow={capabilityBrowseRowToDisplayRow}
    />
  );
}
