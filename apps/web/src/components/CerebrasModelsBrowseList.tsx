import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCerebrasModels } from "@/hooks/use-cerebras-models";
import type { CerebrasModelRow } from "@/lib/cerebras-models";
import { cn } from "@/lib/utils";

export type CerebrasBrowseSelectHandler = (row: CerebrasModelRow) => void;

interface CerebrasModelsBrowseListProps {
  onSelect: CerebrasBrowseSelectHandler;
  className?: string;
}

const MODEL_ROW_HEIGHT = 73;
const MODEL_ROW_OVERSCAN = 6;

export function CerebrasModelsBrowseList({
  onSelect,
  className,
}: CerebrasModelsBrowseListProps) {
  const { data, isLoading, error } = useCerebrasModels();
  const rows = data?.rows ?? [];
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
    <div className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
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
      </div>

      <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        {filtered.length} models
        {usedFallback ? " · using curated fallback catalog" : ""}
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-3 py-8 text-center text-sm text-destructive">
            Failed to load: {String(error)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No models found
          </div>
        ) : (
          <VirtualCerebrasModelList rows={filtered} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

function VirtualCerebrasModelList({
  rows,
  onSelect,
}: {
  rows: CerebrasModelRow[];
  onSelect: CerebrasBrowseSelectHandler;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    element.scrollTop = 0;
    setScrollTop(0);
  }, [rows]);

  const totalHeight = rows.length * MODEL_ROW_HEIGHT;
  const visibleCount = Math.ceil(viewportHeight / MODEL_ROW_HEIGHT);
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / MODEL_ROW_HEIGHT) - MODEL_ROW_OVERSCAN,
  );
  const endIndex = Math.min(
    rows.length,
    startIndex + visibleCount + MODEL_ROW_OVERSCAN * 2,
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {visibleRows.map((row, offset) => (
          <CerebrasModelRowButton
            key={row.id}
            row={row}
            onSelect={onSelect}
            style={{
              height: MODEL_ROW_HEIGHT,
              transform: `translateY(${(startIndex + offset) * MODEL_ROW_HEIGHT}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CerebrasModelRowButton({
  row,
  onSelect,
  style,
}: {
  row: CerebrasModelRow;
  onSelect: CerebrasBrowseSelectHandler;
  style: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      style={style}
      className="absolute left-0 top-0 flex w-full cursor-pointer items-start gap-2.5 border-b border-border px-3 py-2 text-left transition-colors hover:bg-muted"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight text-foreground">
          {row.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[0.7rem] text-muted-foreground">
          {row.id}
        </div>
        {row.description ? (
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {row.description}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          {row.preview ? (
            <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-amber-400 ring-1 ring-amber-500/30">
              preview
            </span>
          ) : null}
          {row.deprecated ? (
            <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-amber-400 ring-1 ring-amber-500/30">
              deprecated
            </span>
          ) : null}
          {row.contextLength > 0 ? (
            <span>
              {row.contextLength >= 1000
                ? `${Math.round(row.contextLength / 1000)}K`
                : row.contextLength}
            </span>
          ) : null}
        </div>
        <div className="flex gap-1">
          {row.tools ? (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem]">tools</span>
          ) : null}
          {row.vision ? (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem]">vision</span>
          ) : null}
          {row.reasoning ? (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem]">reasoning</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
