import { useDeferredValue, useMemo, useState } from "react";
import type { ProviderModelOption } from "@nakama/core/contract";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface OpenCodeGoModelsBrowseListProps {
  models: ProviderModelOption[];
  usedIds?: Set<string>;
  onSelect: (model: ProviderModelOption) => void;
  className?: string;
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
        model.id.toLowerCase().includes(query),
    );
  }, [models, usedIds, deferredSearch]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="border-b border-border px-3 py-2">
        <Input
          placeholder="Search model name or ID…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        {filtered.length} available
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {models.length === 0 ? "No catalog models loaded." : "No models found"}
          </div>
        ) : (
          filtered.map((model) => (
            <button
              key={model.id}
              type="button"
              className="flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
              onClick={() => onSelect(model)}
            >
              <span className="text-sm font-medium text-foreground">{model.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{model.id}</span>
              {model.inputPerMillionUsd !== undefined &&
              model.outputPerMillionUsd !== undefined ? (
                <span className="text-[11px] text-muted-foreground">
                  ${model.inputPerMillionUsd}/M in · ${model.outputPerMillionUsd}/M out
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
