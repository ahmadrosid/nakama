import type { ProviderModelOption } from "@nakama/core/contract";
import { CatalogModelsBrowseList } from "@/components/CatalogModelsBrowseList";

interface OpenCodeGoModelsBrowseListProps {
  className?: string;
  models: ProviderModelOption[];
  onSelect: (model: ProviderModelOption) => void;
  usedIds?: Set<string>;
}

export function OpenCodeGoModelsBrowseList({
  models,
  usedIds,
  onSelect,
  className,
}: OpenCodeGoModelsBrowseListProps) {
  const rows = usedIds?.size
    ? models.filter((model) => !usedIds.has(model.id))
    : models;

  return (
    <CatalogModelsBrowseList
      className={className}
      emptyMessage={
        models.length === 0 ? "No catalog models loaded." : "No models found"
      }
      onSelect={onSelect}
      query={{ canFetch: true }}
      rows={rows}
      status={({ filteredCount }) => `${filteredCount} available`}
      toDisplayRow={(row) => ({
        description:
          row.inputPerMillionUsd !== undefined &&
          row.outputPerMillionUsd !== undefined
            ? `$${row.inputPerMillionUsd}/M in · $${row.outputPerMillionUsd}/M out`
            : undefined,
        id: row.id,
        name: row.name,
      })}
    />
  );
}
