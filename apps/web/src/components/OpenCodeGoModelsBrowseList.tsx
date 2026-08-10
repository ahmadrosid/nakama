import type { ProviderModelOption } from "@nakama/core/contract";
import { useDeferredValue, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    let result = models;

    if (usedIds?.size) {
      result = result.filter((model) => !usedIds.has(model.id));
    }

    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return result;
    }

    return result.filter(
      (model) =>
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query)
    );
  }, [models, usedIds, deferredSearch]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="border-border border-b px-3 py-2">
        <Input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search model name or ID…"
          value={search}
        />
      </div>

      <div className="border-border border-b px-3 py-1.5 text-muted-foreground text-xs">
        {filtered.length} available
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-muted-foreground text-sm">
            {models.length === 0
              ? "No catalog models loaded."
              : "No models found"}
          </div>
        ) : (
          filtered.map((model) => (
            <button
              className="flex w-full flex-col gap-0.5 border-border/60 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
              key={model.id}
              onClick={() => onSelect(model)}
              type="button"
            >
              <span className="font-medium text-foreground text-sm">
                {model.name}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {model.id}
              </span>
              {model.inputPerMillionUsd !== undefined &&
              model.outputPerMillionUsd !== undefined ? (
                <span className="text-[11px] text-muted-foreground">
                  ${model.inputPerMillionUsd}/M in · $
                  {model.outputPerMillionUsd}/M out
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
