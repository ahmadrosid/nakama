import { useDeferredValue, useMemo, useState } from "react";
import {
  BrowseModelRowButton,
  ModelBrowseShell,
  VirtualModelBrowseList,
} from "@/components/ModelBrowseShell";
import { formatBrowseCapabilities } from "@/components/model-browse-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [costFilter, setCostFilter] = useState<"all" | "free">("all");
  const [hideDeprecated, setHideDeprecated] = useState(true);

  const filtered = useMemo(() => {
    let result = rows;
    if (costFilter === "free") {
      result = result.filter((row) => row.isFree);
    }
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
  }, [rows, costFilter, hideDeprecated, deferredSearch]);

  const freeCount = filtered.filter((row) => row.isFree).length;

  return (
    <ModelBrowseShell
      className={className}
      isLoading={isLoading}
      error={error}
      isEmpty={filtered.length === 0}
      status={`${filtered.length} models · ${freeCount} free`}
      toolbar={
        <>
          <Input
            placeholder="Search model name or ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-35 flex-1"
          />
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
                ...(row.isFree ? [{ label: "FREE", tone: "emerald" as const }] : []),
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
