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
  onSelect: OpenRouterBrowseSelectHandler;
  className?: string;
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
      rows={catalogRows}
      onSelect={onSelect}
      className={className}
      query={{ isLoading, error }}
      isDeprecated={(row) => row.deprecated}
      toolbarTrailing={
        <Select
          value={costFilter}
          onValueChange={(value) => setCostFilter(value as "all" | "free")}
        >
          <SelectTrigger className="w-27.5">
            <SelectValue>{costFilter === "free" ? "Free only" : "All"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="free">Free only</SelectItem>
          </SelectContent>
        </Select>
      }
      toDisplayRow={(row) => ({
        id: row.id,
        name: row.name,
        description: row.description || undefined,
        contextLength: row.contextLength,
        badges: [
          ...(row.isFree ? [{ label: "FREE", tone: "emerald" as const }] : []),
          ...(row.deprecated ? [{ label: "deprecated", tone: "amber" as const }] : []),
        ],
        capabilities: formatBrowseCapabilities(row),
      })}
      status={({ filteredCount, filteredRows }) => {
        const freeCount = filteredRows.filter((row) => row.isFree).length;
        return `${filteredCount} models · ${freeCount} free`;
      }}
    />
  );
}
