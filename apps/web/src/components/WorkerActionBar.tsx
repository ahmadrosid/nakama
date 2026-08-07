import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2Icon, PlayIcon, RotateCcwIcon, ScrollTextIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRestartWorker, useStartWorker, useStopWorker } from "@/hooks/use-worker-actions";
import { WorkerLogDialog } from "@/components/WorkerLogDialog";
import { cn } from "@/lib/utils";

function ActionGlyph({
  icon: Icon,
  busy,
  iconClassName,
}: {
  icon: LucideIcon;
  busy: boolean;
  iconClassName?: string;
}) {
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
      <Icon
        className={cn(
          "absolute size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
          busy ? "opacity-0 scale-25 blur-[4px]" : "opacity-100 scale-100 blur-0",
          iconClassName,
        )}
        strokeWidth={2}
        aria-hidden
      />
      <Loader2Icon
        className={cn(
          "absolute size-3.5 animate-spin transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
          busy ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-25 blur-[4px]",
        )}
        strokeWidth={2}
        aria-hidden={!busy}
        {...(busy
          ? { role: "status" as const, "aria-label": "Loading" }
          : {})}
      />
    </span>
  );
}

export function WorkerActionBar({
  running,
  pm2Managed,
  workerName,
  className,
}: {
  running: boolean;
  pm2Managed: boolean;
  workerName: string;
  className?: string;
}) {
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const startWorker = useStartWorker();
  const stopWorker = useStopWorker();
  const restartWorker = useRestartWorker();

  const starting = startWorker.isPending && startWorker.variables === workerName;
  const stopping = stopWorker.isPending && stopWorker.variables === workerName;
  const restarting = restartWorker.isPending && restartWorker.variables === workerName;
  const isBusy = starting || stopping || restarting;

  if (!pm2Managed) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>PM2 not available</span>
    );
  }

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        {running ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isBusy}
              aria-busy={stopping || undefined}
              onClick={() => stopWorker.mutate(workerName)}
            >
              <ActionGlyph icon={SquareIcon} busy={stopping} />
              Stop
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              aria-busy={restarting || undefined}
              onClick={() => restartWorker.mutate(workerName)}
            >
              <ActionGlyph icon={RotateCcwIcon} busy={restarting} />
              Restart
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            aria-busy={starting || undefined}
            onClick={() => startWorker.mutate(workerName)}
          >
            <ActionGlyph icon={PlayIcon} busy={starting} iconClassName="translate-x-px" />
            Start
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setLogDialogOpen(true)}
        >
          <ScrollTextIcon className="size-3.5" strokeWidth={2} aria-hidden />
          View logs
        </Button>
      </div>
      <WorkerLogDialog
        workerName={workerName}
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
      />
    </>
  );
}
