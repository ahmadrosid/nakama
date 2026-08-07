import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2Icon, PlayIcon, RotateCcwIcon, ScrollTextIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRestartWorker, useStartWorker, useStopWorker } from "@/hooks/use-worker-actions";
import { WorkerLogDialog } from "@/components/WorkerLogDialog";
import { cn } from "@/lib/utils";

const glyphTransition =
  "absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]";

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
    <span className="relative size-3.5 shrink-0" aria-hidden={!busy}>
      <Icon
        className={cn(
          glyphTransition,
          busy ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0",
          iconClassName,
        )}
        strokeWidth={2}
        aria-hidden
      />
      <Loader2Icon
        className={cn(
          glyphTransition,
          "animate-spin",
          busy ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]",
        )}
        strokeWidth={2}
        aria-hidden={!busy}
        {...(busy ? { role: "status" as const, "aria-label": "Loading" } : {})}
      />
    </span>
  );
}

export function WorkerActionBar({
  running,
  pm2Managed,
  workerName,
  className,
  showLogs = true,
}: {
  running: boolean;
  pm2Managed: boolean;
  workerName: string;
  className?: string;
  showLogs?: boolean;
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
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
        {showLogs ? (
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
        ) : null}
      </div>
      {showLogs ? (
        <WorkerLogDialog
          workerName={workerName}
          open={logDialogOpen}
          onOpenChange={setLogDialogOpen}
        />
      ) : null}
    </>
  );
}

export function WorkerViewLogsButton({
  workerName,
  className,
}: {
  workerName: string;
  className?: string;
}) {
  const [logDialogOpen, setLogDialogOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("text-muted-foreground", className)}
        onClick={() => setLogDialogOpen(true)}
      >
        <ScrollTextIcon className="size-3.5" strokeWidth={2} aria-hidden />
        View logs
      </Button>
      <WorkerLogDialog
        workerName={workerName}
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
      />
    </>
  );
}
