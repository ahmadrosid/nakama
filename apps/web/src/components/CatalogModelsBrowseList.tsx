import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import {
  BrowseModelRowButton,
  ModelBrowseShell,
  type BrowseModelRowDisplay,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import { filterRowsBySearch } from "@/components/model-browse-utils";
import { Input } from "@/components/ui/input";

export interface CatalogModelsBrowseQuery {
  canFetch?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}

export interface CatalogModelsBrowseListProps<T extends { id: string; name: string }> {
  rows: T[];
  onSelect: (row: T) => void;
  className?: string;
  query?: CatalogModelsBrowseQuery;
  idleMessage?: string;
  emptyMessage?: string;
  status?: ReactNode | ((context: { filteredCount: number; filteredRows: T[] }) => ReactNode);
  toDisplayRow?: (row: T) => BrowseModelRowDisplay;
  filterRows?: (rows: T[], search: string, hideDeprecated: boolean) => T[];
  isDeprecated?: (row: T) => boolean;
  toolbarTrailing?: ReactNode;
}

export function CatalogModelsBrowseList<T extends { id: string; name: string }>({
  rows,
  onSelect,
  className,
  query,
  idleMessage,
  emptyMessage,
  status,
  toDisplayRow = (row) => ({ id: row.id, name: row.name }),
  filterRows,
  isDeprecated,
  toolbarTrailing,
}: CatalogModelsBrowseListProps<T>) {
  const {
    canFetch = true,
    isLoading = false,
    isFetching = false,
    error = null,
    onRefresh,
    refreshDisabled = false,
  } = query ?? {};
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [hideDeprecated, setHideDeprecated] = useState(true);
  const showDeprecatedFilter = Boolean(isDeprecated);

  const filtered = useMemo(() => {
    if (filterRows) {
      return filterRows(rows, deferredSearch, hideDeprecated);
    }

    let result = rows;
    if (showDeprecatedFilter && hideDeprecated) {
      result = result.filter((row) => !isDeprecated!(row));
    }

    return filterRowsBySearch(result, deferredSearch);
  }, [rows, deferredSearch, hideDeprecated, filterRows, isDeprecated, showDeprecatedFilter]);

  const resolvedStatus =
    typeof status === "function"
      ? status({ filteredCount: filtered.length, filteredRows: filtered })
      : status ??
        (canFetch
          ? `${filtered.length} model${filtered.length === 1 ? "" : "s"}`
          : (idleMessage ?? "Enter credentials to browse models."));

  const resolvedEmptyMessage =
    emptyMessage ??
    (canFetch ? "No models found." : (idleMessage ?? "Enter credentials to browse models."));

  const toolbarDisabled = !canFetch;

  return (
    <ModelBrowseShell
      className={className}
      isLoading={canFetch && (isLoading || (isFetching && rows.length === 0))}
      error={canFetch ? error : null}
      isEmpty={!canFetch || filtered.length === 0}
      emptyMessage={resolvedEmptyMessage}
      status={
        onRefresh ? (
          <div className="flex items-center justify-between gap-2">
            <span>{resolvedStatus}</span>
            <button
              type="button"
              className="text-foreground underline-offset-2 hover:underline disabled:opacity-50"
              disabled={toolbarDisabled || refreshDisabled || isFetching}
              onClick={onRefresh}
            >
              Refresh
            </button>
          </div>
        ) : (
          resolvedStatus
        )
      }
      toolbar={
        <>
          <Input
            placeholder="Search model name or ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-35 flex-1"
            disabled={toolbarDisabled}
          />
          {toolbarTrailing}
          {showDeprecatedFilter ? (
            <label className="flex h-8 cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={hideDeprecated}
                onChange={(event) => setHideDeprecated(event.target.checked)}
                disabled={toolbarDisabled}
              />
              Hide deprecated
            </label>
          ) : null}
        </>
      }
    >
      <VirtualModelBrowseList
        rows={filtered}
        getKey={(row) => row.id}
        renderRow={(row, style) => (
          <BrowseModelRowButton
            row={toDisplayRow(row)}
            onSelect={() => onSelect(row)}
            style={style}
          />
        )}
      />
    </ModelBrowseShell>
  );
}
