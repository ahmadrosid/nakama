import { TASK_COLUMN_META } from "@/lib/task-board";
import { cn } from "@/lib/utils";

export function TaskBoardSkeleton() {
  return (
    <div
      className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory"
      aria-busy="true"
      aria-label="Loading agent swarm board"
    >
      {TASK_COLUMN_META.map((column) => (
        <div
          key={column.id}
          className={cn(
            "flex min-h-[24rem] w-72 shrink-0 snap-start flex-col rounded-lg border border-border bg-muted/20",
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="h-4 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-5 w-8 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          </div>
          <div className="flex flex-1 flex-col gap-2 p-2">
            <div className="h-24 animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none" />
            <div className="h-20 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
