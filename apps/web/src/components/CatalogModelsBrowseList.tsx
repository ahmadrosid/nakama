import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import {
  BrowseModelRowButton,
  type BrowseModelRowDisplay,
  ModelBrowseShell,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import { filterRowsBySearch } from "@/components/model-browse-utils";
import { Button } from "@/components/ui/button";
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
  multiSelect?: boolean;
  onAddMany?: (rows: T[]) => void;
  onSelect: (row: T) => void;
  query?: CatalogModelsBrowseQuery;
  rows: T[];
  status?:
    | ReactNode
    | ((context: { filteredCount: number; filteredRows: T[] }) => ReactNode);
  toDisplayRow?: (row: T) => BrowseModelRowDisplay;
  toolbarTrailing?: ReactNode;
}

function filterCatalogRows<T extends { id: string; name: string }>(
  rows: T[],
  deferredSearch: string,
  hideDeprecated: boolean,
  filterRows: CatalogModelsBrowseListProps<T>["filterRows"],
  isDeprecated: CatalogModelsBrowseListProps<T>["isDeprecated"],
  showDeprecatedFilter: boolean
): T[] {
  if (filterRows) {
    return filterRows(rows, deferredSearch, hideDeprecated);
  }

  const visible =
    showDeprecatedFilter && hideDeprecated
      ? rows.filter((row) => !isDeprecated!(row))
      : rows;

  return filterRowsBySearch(visible, deferredSearch);
}

function resolveCatalogStatus<T extends { id: string; name: string }>(
  status: CatalogModelsBrowseListProps<T>["status"],
  filtered: T[],
  canFetch: boolean,
  idleMessage?: string
): ReactNode {
  if (typeof status === "function") {
    return status({ filteredCount: filtered.length, filteredRows: filtered });
  }

  if (status != null) {
    return status;
  }

  if (canFetch) {
    return `${filtered.length} model${filtered.length === 1 ? "" : "s"}`;
  }

  return idleMessage ?? "Enter credentials to browse models.";
}

function resolveCatalogEmptyMessage(
  emptyMessage: string | undefined,
  canFetch: boolean,
  idleMessage?: string
): string {
  if (emptyMessage) {
    return emptyMessage;
  }

  if (canFetch) {
    return "No models found.";
  }

  return idleMessage ?? "Enter credentials to browse models.";
}

function CatalogBrowseToolbar({
  search,
  onSearchChange,
  toolbarDisabled,
  toolbarTrailing,
  showDeprecatedFilter,
  hideDeprecated,
  onHideDeprecatedChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  toolbarDisabled: boolean;
  toolbarTrailing?: ReactNode;
  showDeprecatedFilter: boolean;
  hideDeprecated: boolean;
  onHideDeprecatedChange: (value: boolean) => void;
}) {
  return (
    <>
      <Input
        className="min-w-35 flex-1"
        disabled={toolbarDisabled}
        onChange={(event) => onSearchChange(event.target.value)}
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
            onChange={(event) => onHideDeprecatedChange(event.target.checked)}
            type="checkbox"
          />
          Hide deprecated
        </label>
      ) : null}
    </>
  );
}

function CatalogBrowseStatus({
  status,
  onRefresh,
  toolbarDisabled,
  refreshDisabled,
  isFetching,
}: {
  status: ReactNode;
  onRefresh?: () => void;
  toolbarDisabled: boolean;
  refreshDisabled: boolean;
  isFetching: boolean;
}) {
  if (!onRefresh) {
    return status;
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span>{status}</span>
      <button
        className="text-foreground underline-offset-2 hover:underline disabled:opacity-50"
        disabled={toolbarDisabled || refreshDisabled || isFetching}
        onClick={onRefresh}
        type="button"
      >
        Refresh
      </button>
    </div>
  );
}

function CatalogBrowseFooter({
  selectedCount,
  onAddMany,
}: {
  selectedCount: number;
  onAddMany: () => void;
}) {
  return (
    <div className="sticky bottom-0 flex shrink-0 justify-end border-border border-t bg-background px-3 py-2">
      <Button
        disabled={selectedCount === 0}
        onClick={onAddMany}
        size="sm"
        type="button"
      >
        Add {selectedCount} models
      </Button>
    </div>
  );
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
  multiSelect = false,
  onAddMany,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const showDeprecatedFilter = Boolean(isDeprecated);

  const selectedRowIds = useMemo(() => {
    if (!multiSelect) {
      return new Set<string>();
    }
    const rowIds = new Set(rows.map((row) => row.id));
    return new Set([...selectedIds].filter((id) => rowIds.has(id)));
  }, [multiSelect, rows, selectedIds]);

  const filtered = useMemo(
    () =>
      filterCatalogRows(
        rows,
        deferredSearch,
        hideDeprecated,
        filterRows,
        isDeprecated,
        showDeprecatedFilter
      ),
    [
      rows,
      deferredSearch,
      hideDeprecated,
      filterRows,
      isDeprecated,
      showDeprecatedFilter,
    ]
  );

  const resolvedStatus = resolveCatalogStatus(
    status,
    filtered,
    canFetch,
    idleMessage
  );
  const resolvedEmptyMessage = resolveCatalogEmptyMessage(
    emptyMessage,
    canFetch,
    idleMessage
  );
  const toolbarDisabled = !canFetch;

  const handleRowSelect = (row: T) => {
    if (!multiSelect) {
      onSelect(row);
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      return next;
    });
  };

  const handleAddMany = () => {
    onAddMany?.(rows.filter((row) => selectedRowIds.has(row.id)));
    setSelectedIds(new Set<string>());
  };

  return (
    <ModelBrowseShell
      className={className}
      emptyMessage={resolvedEmptyMessage}
      error={canFetch ? error : null}
      footer={
        multiSelect ? (
          <CatalogBrowseFooter
            onAddMany={handleAddMany}
            selectedCount={selectedRowIds.size}
          />
        ) : undefined
      }
      isEmpty={!canFetch || filtered.length === 0}
      isLoading={canFetch && (isLoading || (isFetching && rows.length === 0))}
      status={
        <CatalogBrowseStatus
          isFetching={isFetching}
          onRefresh={onRefresh}
          refreshDisabled={refreshDisabled}
          status={resolvedStatus}
          toolbarDisabled={toolbarDisabled}
        />
      }
      toolbar={
        <CatalogBrowseToolbar
          hideDeprecated={hideDeprecated}
          onHideDeprecatedChange={setHideDeprecated}
          onSearchChange={setSearch}
          search={search}
          showDeprecatedFilter={showDeprecatedFilter}
          toolbarDisabled={toolbarDisabled}
          toolbarTrailing={toolbarTrailing}
        />
      }
    >
      <VirtualModelBrowseList
        getKey={(row) => row.id}
        renderRow={(row, style) => (
          <BrowseModelRowButton
            onSelect={() => handleRowSelect(row)}
            row={toDisplayRow(row)}
            selectable={multiSelect}
            selected={selectedRowIds.has(row.id)}
            style={style}
          />
        )}
        rows={filtered}
      />
    </ModelBrowseShell>
  );
}
