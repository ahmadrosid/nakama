import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import {
  BrowseModelRowButton,
  type BrowseModelRowDisplay,
  ModelBrowseShell,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import { filterRowsBySearch } from "@/components/model-browse-utils";
import { Input } from "@/components/ui/input";

export interface CatalogModelsBrowseQuery {
  canFetch?: boolean;
  error?: Error | null;
  isFetching?: boolean;
  isLoading?: boolean;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}

export interface CatalogModelsBrowseListProps<
  T extends { id: string; name: string },
> {
  className?: string;
  emptyMessage?: string;
  filterRows?: (rows: T[], search: string, hideDeprecated: boolean) => T[];
  idleMessage?: string;
  isDeprecated?: (row: T) => boolean;
  onSelect: (row: T) => void;
  query?: CatalogModelsBrowseQuery;
  rows: T[];
  status?:
    | ReactNode
    | ((context: { filteredCount: number; filteredRows: T[] }) => ReactNode);
  toDisplayRow?: (row: T) => BrowseModelRowDisplay;
  toolbarTrailing?: ReactNode;
}

export function CatalogModelsBrowseList<
  T extends { id: string; name: string },
>({
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
  }, [
    rows,
    deferredSearch,
    hideDeprecated,
    filterRows,
    isDeprecated,
    showDeprecatedFilter,
  ]);

  const resolvedStatus =
    typeof status === "function"
      ? status({ filteredCount: filtered.length, filteredRows: filtered })
      : (status ??
        (canFetch
          ? `${filtered.length} model${filtered.length === 1 ? "" : "s"}`
          : (idleMessage ?? "Enter credentials to browse models.")));

  const resolvedEmptyMessage =
    emptyMessage ??
    (canFetch
      ? "No models found."
      : (idleMessage ?? "Enter credentials to browse models."));

  const toolbarDisabled = !canFetch;

  return (
    <ModelBrowseShell
      className={className}
      emptyMessage={resolvedEmptyMessage}
      error={canFetch ? error : null}
      isEmpty={!canFetch || filtered.length === 0}
      isLoading={canFetch && (isLoading || (isFetching && rows.length === 0))}
      status={
        onRefresh ? (
          <div className="flex items-center justify-between gap-2">
            <span>{resolvedStatus}</span>
            <button
              className="text-foreground underline-offset-2 hover:underline disabled:opacity-50"
              disabled={toolbarDisabled || refreshDisabled || isFetching}
              onClick={onRefresh}
              type="button"
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
            className="min-w-35 flex-1"
            disabled={toolbarDisabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search model name or ID..."
            value={search}
          />
          {toolbarTrailing}
          {showDeprecatedFilter ? (
            <label className="flex h-8 cursor-pointer items-center gap-2 text-foreground text-sm">
              <input
                checked={hideDeprecated}
                className="size-4 rounded border-input"
                disabled={toolbarDisabled}
                onChange={(event) => setHideDeprecated(event.target.checked)}
                type="checkbox"
              />
              Hide deprecated
            </label>
          ) : null}
        </>
      }
    >
      <VirtualModelBrowseList
        getKey={(row) => row.id}
        renderRow={(row, style) => (
          <BrowseModelRowButton
            onSelect={() => onSelect(row)}
            row={toDisplayRow(row)}
            style={style}
          />
        )}
        rows={filtered}
      />
    </ModelBrowseShell>
  );
}
