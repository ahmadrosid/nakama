import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import {
  capabilityBrowseRowToDisplayRow,
  filterCapabilityBrowseRows,
} from "@/components/model-browse-utils";
import { useCerebrasModels } from "@/hooks/use-cerebras-models";
import type { CerebrasModelRow } from "@/lib/cerebras-models";

export type CerebrasBrowseSelectHandler = (row: CerebrasModelRow) => void;

interface CerebrasModelsBrowseListProps {
  onSelect: CerebrasBrowseSelectHandler;
  className?: string;
}

const EMPTY_ROWS: CerebrasModelRow[] = [];

export function CerebrasModelsBrowseList({
  onSelect,
  className,
}: CerebrasModelsBrowseListProps) {
  const { data, isLoading, error } = useCerebrasModels();

  return (
    <CatalogModelsBrowseList<CerebrasModelRow>
      rows={data?.rows ?? EMPTY_ROWS}
      onSelect={onSelect}
      className={className}
      query={{ isLoading, error }}
      isDeprecated={(row) => row.deprecated}
      toDisplayRow={capabilityBrowseRowToDisplayRow}
      filterRows={(rows, search, hideDeprecated) =>
        filterCapabilityBrowseRows(rows, { search, hideDeprecated }) as CerebrasModelRow[]
      }
      status={({ filteredCount }) =>
        `${filteredCount} models${data?.usedFallback ? " · using curated fallback catalog" : ""}`
      }
    />
  );
}
