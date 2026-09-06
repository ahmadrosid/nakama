import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useLayoutEffect,
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
import { Spinner } from "@/components/ui/spinner";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

export type ModelCostFilter = "all" | "free";

export function ModelCostFilterSelect({
  value,
  onValueChange,
}: {
  onValueChange: (value: ModelCostFilter) => void;
  value: ModelCostFilter;
}) {
  return (
    <Select
      onValueChange={(next) => onValueChange(next as ModelCostFilter)}
      value={value}
    >
      <SelectTrigger className="w-27.5">
        <SelectValue>{value === "free" ? "Free only" : "All"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="free">Free only</SelectItem>
      </SelectContent>
    </Select>
  );
}

const MODEL_ROW_HEIGHT = 73;
const MODEL_ROW_OVERSCAN = 6;

export type BrowseModelBadgeTone = "emerald" | "amber";

export interface BrowseModelRowDisplay {
  badges?: Array<{ label: string; tone: BrowseModelBadgeTone }>;
  capabilities?: Array<"tools" | "vision" | "reasoning">;
  contextLength?: number;
  description?: string;
  id: string;
  name: string;
}

export function ModelBrowseShell({
  className,
  toolbar,
  status,
  isLoading,
  error,
  isEmpty,
  emptyMessage = "No models found",
  footer,
  children,
}: {
  className?: string;
  toolbar: ReactNode;
  status: ReactNode;
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyMessage?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-border border-b px-3 py-2">
        {toolbar}
      </div>

      <div className="border-border border-b px-3 py-1.5 text-muted-foreground text-xs">
        {status}
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-3 py-8 text-center text-destructive text-sm">
            Failed to load: {formatError(error)}
          </div>
        ) : isEmpty ? (
          <div className="px-3 py-8 text-center text-muted-foreground text-sm">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
      {footer}
    </div>
  );
}

export function VirtualModelBrowseList<T>({
  rows,
  getKey,
  renderRow,
}: {
  rows: T[];
  getKey: (row: T) => string;
  renderRow: (row: T, style: CSSProperties) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [prevRows, setPrevRows] = useState(rows);

  if (prevRows !== rows) {
    setPrevRows(rows);
    setScrollTop(0);
  }

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = 0;
  }, [rows]);

  const totalHeight = rows.length * MODEL_ROW_HEIGHT;
  const visibleCount = Math.ceil(viewportHeight / MODEL_ROW_HEIGHT);
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / MODEL_ROW_HEIGHT) - MODEL_ROW_OVERSCAN
  );
  const endIndex = Math.min(
    rows.length,
    startIndex + visibleCount + MODEL_ROW_OVERSCAN * 2
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <div
      className="h-full overflow-y-auto"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={scrollRef}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {visibleRows.map((row, offset) => (
          <Fragment key={getKey(row)}>
            {renderRow(row, {
              height: MODEL_ROW_HEIGHT,
              transform: `translateY(${(startIndex + offset) * MODEL_ROW_HEIGHT}px)`,
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const BADGE_TONES: Record<BrowseModelBadgeTone, string> = {
  amber: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
  emerald: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
};

export function BrowseModelRowButton({
  row,
  onSelect,
  selectable = false,
  selected = false,
  style,
}: {
  row: BrowseModelRowDisplay;
  onSelect: () => void;
  selectable?: boolean;
  selected?: boolean;
  style: CSSProperties;
}) {
  return (
    <button
      aria-pressed={selectable ? selected : undefined}
      className="absolute top-0 left-0 flex w-full cursor-pointer items-start gap-2.5 border-border border-b px-3 py-2 text-left transition-colors hover:bg-muted"
      onClick={onSelect}
      style={style}
      type="button"
    >
      {selectable ? (
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-input font-bold text-2xs",
            selected && "border-emerald-500 bg-emerald-500 text-white"
          )}
        >
          {selected ? "✓" : null}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm leading-tight">
          {row.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
          {row.id}
        </div>
        {row.description ? (
          <div className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
            {row.description}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-muted-foreground text-xs">
        <div className="flex items-center gap-1">
          {(row.badges ?? []).map((badge) => (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 font-bold text-2xs uppercase tracking-wide ${BADGE_TONES[badge.tone]}`}
              key={badge.label}
            >
              {badge.label}
            </span>
          ))}
          {row.contextLength && row.contextLength > 0 ? (
            <span>
              {row.contextLength >= 1000
                ? `${Math.round(row.contextLength / 1000)}K`
                : row.contextLength}
            </span>
          ) : null}
        </div>
        {(row.capabilities?.length ?? 0) > 0 ? (
          <div className="flex gap-1">
            {row.capabilities!.map((capability) => (
              <span
                className="rounded bg-muted px-1 py-0.5 text-2xs"
                key={capability}
              >
                {capability}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}
