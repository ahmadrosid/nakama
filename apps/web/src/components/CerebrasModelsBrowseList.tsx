import { useDeferredValue, useMemo, useState } from "react";
import {
  BrowseModelRowButton,
  formatBrowseCapabilities,
  ModelBrowseShell,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import { Input } from "@/components/ui/input";
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
  const rows = data?.rows ?? EMPTY_ROWS;
  const usedFallback = data?.usedFallback ?? false;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [hideDeprecated, setHideDeprecated] = useState(true);

  const filtered = useMemo(() => {
    let result = rows;
    if (hideDeprecated) {
      result = result.filter((row) => !row.deprecated);
    }
    const query = deferredSearch.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (row) =>
          row.name.toLowerCase().includes(query) ||
          row.id.toLowerCase().includes(query) ||
          row.description.toLowerCase().includes(query),
      );
    }
    return result;
  }, [rows, hideDeprecated, deferredSearch]);

  return (
    <ModelBrowseShell
      className={className}
      isLoading={isLoading}
      error={error}
      isEmpty={filtered.length === 0}
      status={`${filtered.length} models${usedFallback ? " · using curated fallback catalog" : ""}`}
      toolbar={
        <>
          <Input
            placeholder="Search model name or ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-35 flex-1"
          />
          <label className="flex h-8 cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={hideDeprecated}
              onChange={(event) => setHideDeprecated(event.target.checked)}
            />
            Hide deprecated
          </label>
        </>
      }
    >
      <VirtualModelBrowseList
        rows={filtered}
        getKey={(row) => row.id}
        renderRow={(row, style) => (
          <BrowseModelRowButton
            row={{
              id: row.id,
              name: row.name,
              description: row.description || undefined,
              contextLength: row.contextLength,
              badges: [
                ...(row.preview ? [{ label: "preview", tone: "amber" as const }] : []),
                ...(row.deprecated
                  ? [{ label: "deprecated", tone: "amber" as const }]
                  : []),
              ],
              capabilities: formatBrowseCapabilities(row),
            }}
            onSelect={() => onSelect(row)}
            style={style}
          />
        )}
      />
    </ModelBrowseShell>
  );
}
