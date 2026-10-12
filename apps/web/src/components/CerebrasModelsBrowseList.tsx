import { queryOptions, useQuery } from "@tanstack/react-query";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import {
  capabilityBrowseRowToDisplayRow,
  filterCapabilityBrowseRows,
} from "@/components/model-browse-utils";
import {
  CEREBRAS_FALLBACK_MODELS,
  type CerebrasModelRow,
  type CerebrasModelsApiResponse,
  normalizeCerebrasModels,
} from "@/lib/cerebras-models";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

async function fetchCerebrasModels(): Promise<{
  rows: CerebrasModelRow[];
  usedFallback: boolean;
}> {
  try {
    // SAFETY: The enclosing parser checks the value before this conversion.
    const data = (await client.getExternalModelCatalog(
      "cerebras"
    )) as CerebrasModelsApiResponse;

    const rows = normalizeCerebrasModels(data);

    if (rows.length === 0) {
      return { rows: CEREBRAS_FALLBACK_MODELS, usedFallback: true };
    }

    return { rows, usedFallback: false };
  } catch {
    return { rows: CEREBRAS_FALLBACK_MODELS, usedFallback: true };
  }
}

const cerebrasModelsQueryOptions = queryOptions({
  queryFn: fetchCerebrasModels,
  queryKey: queryKeys.cerebrasModels,
  staleTime: 1000 * 60 * 30,
});

function useCerebrasModels() {
  return useQuery(cerebrasModelsQueryOptions);
}

type CerebrasBrowseSelectHandler = (row: CerebrasModelRow) => void;

interface CerebrasModelsBrowseListProps {
  className?: string;
  multiSelect?: boolean;
  onAddMany?: (rows: CerebrasModelRow[]) => void;
  onSelect: CerebrasBrowseSelectHandler;
}

const EMPTY_ROWS: CerebrasModelRow[] = [];

export function CerebrasModelsBrowseList({
  onSelect,
  className,
  multiSelect,
  onAddMany,
}: CerebrasModelsBrowseListProps) {
  const { data, isLoading, error } = useCerebrasModels();

  return (
    <CatalogModelsBrowseList<CerebrasModelRow>
      className={className}
      filterRows={(rows, search, hideDeprecated) =>
        filterCapabilityBrowseRows(rows, {
          hideDeprecated,
          search,
        })
      }
      isDeprecated={(row) => row.deprecated}
      multiSelect={multiSelect}
      onAddMany={onAddMany}
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
