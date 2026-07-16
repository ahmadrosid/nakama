import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function SwarmMetricTile({
  label,
  value,
  hint,
  highlight = false,
  warn = false,
  compact = false,
}: {
  label: string;
  value: number;
  hint: string;
  highlight?: boolean;
  warn?: boolean;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "min-w-0 overflow-hidden shadow-none",
        highlight && "border-amber-300/50 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20",
        warn && value > 0 && "border-red-300/50 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 p-3 pb-1">
        <CardDescription className="min-w-0 truncate text-xs">{label}</CardDescription>
        <CardTitle
          className={cn(
            "shrink-0 tabular-nums",
            compact ? "text-lg @sm/metrics:text-xl" : "text-xl @sm/metrics:text-2xl",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <p
          className={cn(
            "text-muted-foreground",
            compact
              ? "line-clamp-2 text-[11px] @sm/metrics:line-clamp-1 @sm/metrics:text-xs"
              : "line-clamp-2 text-xs @sm/metrics:line-clamp-1",
          )}
        >
          {hint}
        </p>
      </CardContent>
    </Card>
  );
}

export function TasksPageMetrics({
  metrics,
  compact,
}: {
  metrics: {
    total: number;
    inProgress: number;
    done: number;
    failed: number;
  };
  compact: boolean;
}) {
  return (
    <div className="@container/metrics mt-5 min-w-0">
      <div
        className={cn(
          "grid grid-cols-1 gap-2 sm:gap-3",
          "@sm/metrics:grid-cols-2 @2xl/metrics:grid-cols-4",
        )}
      >
        <SwarmMetricTile
          label="Total tasks"
          value={metrics.total}
          hint="All columns"
          compact={compact}
        />
        <SwarmMetricTile
          label="In progress"
          value={metrics.inProgress}
          hint="Agents currently running"
          highlight={metrics.inProgress > 0}
          compact={compact}
        />
        <SwarmMetricTile
          label="Completed"
          value={metrics.done}
          hint="Successful runs"
          compact={compact}
        />
        <SwarmMetricTile
          label="Failed"
          value={metrics.failed}
          hint="Needs attention"
          warn={metrics.failed > 0}
          compact={compact}
        />
      </div>
    </div>
  );
}
