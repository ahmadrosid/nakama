import { queryOptions, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import {
  type ModelCostFilter,
  ModelCostFilterSelect,
} from "@/components/ModelBrowseShell";
import { formatBrowseCapabilities } from "@/components/model-browse-utils";
import { client } from "@/lib/client";
import {
  normalizeOpenRouterModels,
  type OpenRouterModelRow,
  type OpenRouterModelsApiResponse,
} from "@/lib/openrouter-models";
import { queryKeys } from "@/lib/query-keys";

async function fetchOpenRouterModels(): Promise<OpenRouterModelRow[]> {
  // SAFETY: The enclosing parser checks the value before this conversion.
  const data = (await client.getExternalModelCatalog(
    "openrouter"
  )) as OpenRouterModelsApiResponse;

  return normalizeOpenRouterModels(data);
}

const openRouterModelsQueryOptions = queryOptions({
  queryFn: fetchOpenRouterModels,
  queryKey: queryKeys.openRouterModels,
  staleTime: 1000 * 60 * 30,
});

function useOpenRouterModels() {
  return useQuery(openRouterModelsQueryOptions);
}

type OpenRouterBrowseSelectHandler = (row: OpenRouterModelRow) => void;

interface OpenRouterModelsBrowseListProps {
  className?: string;
  multiSelect?: boolean;
  onAddMany?: (rows: OpenRouterModelRow[]) => void;
  onSelect: OpenRouterBrowseSelectHandler;
}

export function OpenRouterModelsBrowseList({
  onSelect,
  className,
  multiSelect,
  onAddMany,
}: OpenRouterModelsBrowseListProps) {
  const { data: rows = [], isLoading, error } = useOpenRouterModels();
  const [costFilter, setCostFilter] = useState<ModelCostFilter>("all");
  const deferredCostFilter = useDeferredValue(costFilter);

  const catalogRows = useMemo(() => {
    if (deferredCostFilter === "free") {
      return rows.filter((row) => row.isFree);
    }

    return rows;
  }, [rows, deferredCostFilter]);

  return (
    <CatalogModelsBrowseList<OpenRouterModelRow>
      className={className}
      isDeprecated={(row) => row.deprecated}
      multiSelect={multiSelect}
      onAddMany={onAddMany}
      onSelect={onSelect}
      query={{ error, isLoading }}
      rows={catalogRows}
      status={({ filteredCount, filteredRows }) => {
        const freeCount = filteredRows.filter((row) => row.isFree).length;

        return `${filteredCount} models · ${freeCount} free`;
      }}
      toDisplayRow={(row) => ({
        badges: [
          ...(row.isFree ? [{ label: "FREE", tone: "emerald" as const }] : []),
          ...(row.deprecated
            ? [{ label: "deprecated", tone: "amber" as const }]
            : []),
        ],
        capabilities: formatBrowseCapabilities(row),
        contextLength: row.contextLength,
        description: row.description || undefined,
        id: row.id,
        name: row.name,
      })}
      toolbarTrailing={
        <ModelCostFilterSelect
          onValueChange={setCostFilter}
          value={costFilter}
        />
      }
    />
  );
}
