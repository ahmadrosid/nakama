import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import {
  type ModelCostFilter,
  ModelCostFilterSelect,
} from "@/components/ModelBrowseShell";
import { formatBrowseCapabilities } from "@/components/model-browse-utils";
import {
  isOpenRouterModelType,
  OPENROUTER_MODEL_TYPES,
  type OpenRouterModelRow,
  type OpenRouterModelType,
  openRouterModelsQueryOptions,
} from "@/lib/openrouter-models";

type ModelTypeFilter = OpenRouterModelType | "all";

function ModelTypeFilterSelect({
  value,
  onValueChange,
}: {
  onValueChange: (value: ModelTypeFilter) => void;
  value: ModelTypeFilter;
}) {
  return (
    <Select
      onValueChange={(next) => {
        const type = OPENROUTER_MODEL_TYPES.find(
          (entry) => entry.value === next
        );

        onValueChange(type ? type.value : "all");
      }}
      value={value}
    >
      <SelectTrigger aria-label="Model type" className="w-35">
        <SelectValue>
          {OPENROUTER_MODEL_TYPES.find((entry) => entry.value === value)
            ?.label ?? "All types"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        {OPENROUTER_MODEL_TYPES.map((entry) => (
          <SelectItem key={entry.value} value={entry.value}>
            {entry.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useOpenRouterModels() {
  return useQuery(openRouterModelsQueryOptions);
}

type OpenRouterBrowseSelectHandler = (row: OpenRouterModelRow) => void;

interface OpenRouterModelsBrowseListProps {
  addedIds?: ReadonlySet<string>;
  className?: string;
  multiSelect?: boolean;
  onAddMany?: (rows: OpenRouterModelRow[]) => void;
  onSelect: OpenRouterBrowseSelectHandler;
}

export function OpenRouterModelsBrowseList({
  onSelect,
  className,
  addedIds,
  multiSelect,
  onAddMany,
}: OpenRouterModelsBrowseListProps) {
  const { data: rows = [], isLoading, error } = useOpenRouterModels();
  const [costFilter, setCostFilter] = useState<ModelCostFilter>("all");
  const deferredCostFilter = useDeferredValue(costFilter);
  // Text first: the chat models are what most providers are added for.
  const [typeFilter, setTypeFilter] = useState<ModelTypeFilter>("text");
  const deferredTypeFilter = useDeferredValue(typeFilter);

  const catalogRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (deferredCostFilter !== "free" || row.isFree) &&
          (deferredTypeFilter === "all" ||
            isOpenRouterModelType(row, deferredTypeFilter))
      ),
    [rows, deferredCostFilter, deferredTypeFilter]
  );

  return (
    <CatalogModelsBrowseList<OpenRouterModelRow>
      addedIds={addedIds}
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
        <>
          <ModelTypeFilterSelect
            onValueChange={setTypeFilter}
            value={typeFilter}
          />
          <ModelCostFilterSelect
            onValueChange={setCostFilter}
            value={costFilter}
          />
        </>
      }
    />
  );
}
