import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type ModelsDevRow, useModelsDev } from "@/hooks/use-models-dev";
import type { SelectedProvider } from "@/lib/models";
import { cn } from "@/lib/utils";

export type BrowseSelectHandler = (
  provider: SelectedProvider,
  modelId: string,
  row: ModelsDevRow,
) => void;

interface ModelsBrowseListProps {
  onSelect: BrowseSelectHandler;
  className?: string;
  provider?: SelectedProvider;
}

const MODEL_ROW_HEIGHT = 73;
const MODEL_ROW_OVERSCAN = 6;

export function ModelsBrowseList({ onSelect, className, provider }: ModelsBrowseListProps) {
  const { data: rows = [], isLoading, error } = useModelsDev();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [costFilter, setCostFilter] = useState<"all" | "free">("all");
  const [hideDeprecated, setHideDeprecated] = useState(true);

  const sortedRows = useMemo(() => {
    return [...rows].sort(compareModelRows);
  }, [rows]);

  const filtered = useMemo(() => {
    let result = sortedRows;
    if (costFilter === "free") result = result.filter((row) => row.isFree);
    if (hideDeprecated) result = result.filter((row) => !row.deprecated);
    if (provider) result = result.filter((row) => row.nakamaProvider === provider);
    const query = deferredSearch.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (row) =>
          row.providerName.toLowerCase().includes(query) ||
          row.modelName.toLowerCase().includes(query) ||
          row.modelId.toLowerCase().includes(query),
      );
    }
    return result;
  }, [sortedRows, costFilter, hideDeprecated, deferredSearch, provider]);

  const freeCount = filtered.filter((row) => row.isFree).length;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Input
          placeholder="Search provider or model..."
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
      </div>

      <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        {filtered.length} models · {freeCount} free
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
          <VirtualModelList rows={filtered} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

function compareModelRows(a: ModelsDevRow, b: ModelsDevRow): number {
  const publicA = a.isZen && a.isFree && !a.deprecated;
  const publicB = b.isZen && b.isFree && !b.deprecated;
  if (publicA !== publicB) return publicA ? -1 : 1;
  if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
  const byProvider = a.providerName.localeCompare(b.providerName);
  if (byProvider !== 0) return byProvider;
  return a.modelName.localeCompare(b.modelName);
}

function VirtualModelList({
  rows,
  onSelect,
}: {
  rows: ModelsDevRow[];
  onSelect: BrowseSelectHandler;
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
          <ModelRowButton
            key={`${row.providerId}-${row.modelId}`}
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

function ModelRowButton({
  row,
  onSelect,
  style,
}: {
  row: ModelsDevRow;
  onSelect: BrowseSelectHandler;
  style: React.CSSProperties;
}) {
  const isPublicKey = row.isZen && row.isFree && !row.deprecated;

  return (
    <button
      type="button"
      onClick={() => onSelect(row.nakamaProvider, row.modelId, row)}
      disabled={!row.supported}
      title={row.unsupportedReason}
      style={style}
      className={cn(
        "absolute left-0 top-0 flex w-full items-start gap-2.5 border-b border-border px-3 py-2 text-left transition-colors",
        row.supported
          ? "cursor-pointer hover:bg-muted"
          : "cursor-not-allowed opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-xs text-muted-foreground">
          {row.providerName}
        </div>
        <div className="truncate text-sm font-medium leading-tight text-foreground">
          {row.modelName}
        </div>
        <div className="mt-0.5 truncate font-mono text-[0.7rem] text-muted-foreground">
          {row.modelId}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          {isPublicKey && (
            <span className="inline-flex items-center rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-sky-400 ring-1 ring-sky-500/30">
              public
            </span>
          )}
          {row.isFree && (
            <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-emerald-400 ring-1 ring-emerald-500/30">
              FREE
            </span>
          )}
          {row.experimental && (
            <span
              title="Untested with nakama — feature support (tools, JSON mode, streaming) may vary."
              className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-amber-400 ring-1 ring-amber-500/30"
            >
              experimental
            </span>
          )}
          {row.context > 0 && (
            <span>
              {row.context >= 1000 ? `${Math.round(row.context / 1000)}K` : row.context}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {row.toolCall && (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem]">tools</span>
          )}
          {row.vision && (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem]">vision</span>
          )}
          {row.reasoning && (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem]">reasoning</span>
          )}
          {!row.supported && (
            <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem] uppercase">
              n/a
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
