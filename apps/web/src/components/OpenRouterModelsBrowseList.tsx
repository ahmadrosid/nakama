import { useDeferredValue, useMemo, useState } from "react";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";
import { formatBrowseCapabilities } from "@/components/model-browse-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOpenRouterModels } from "@/hooks/use-openrouter-models";
import type { OpenRouterModelRow } from "@/lib/openrouter-models";

export type OpenRouterBrowseSelectHandler = (row: OpenRouterModelRow) => void;

interface OpenRouterModelsBrowseListProps {
  className?: string;
  onSelect: OpenRouterBrowseSelectHandler;
}

export function OpenRouterModelsBrowseList({
  onSelect,
  className,
}: OpenRouterModelsBrowseListProps) {
  const { data: rows = [], isLoading, error } = useOpenRouterModels();
  const [costFilter, setCostFilter] = useState<"all" | "free">("all");
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
        <Select
          onValueChange={(value) => setCostFilter(value as "all" | "free")}
          value={costFilter}
        >
          <SelectTrigger className="w-27.5">
            <SelectValue>
              {costFilter === "free" ? "Free only" : "All"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="free">Free only</SelectItem>
          </SelectContent>
        </Select>
      }
    />
  );
}
