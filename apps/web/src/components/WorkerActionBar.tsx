import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRestartWorker, useStartWorker, useStopWorker } from "@/hooks/use-worker-actions";
import { WorkerLogDialog } from "@/components/WorkerLogDialog";
import { cn } from "@/lib/utils";

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

  const isLoading =
    (startWorker.isPending && startWorker.variables === workerName) ||
    (stopWorker.isPending && stopWorker.variables === workerName) ||
    (restartWorker.isPending && restartWorker.variables === workerName);

  if (!pm2Managed) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>PM2 not available</span>
    );
  }

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {running ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => stopWorker.mutate(workerName)}
            >
              {isLoading ? <Spinner className="size-3" /> : null}
              Stop
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => restartWorker.mutate(workerName)}
            >
              {isLoading ? <Spinner className="size-3" /> : null}
              Restart
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => startWorker.mutate(workerName)}
          >
            {isLoading ? <Spinner className="size-3" /> : null}
            Start
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLogDialogOpen(true)}
        >
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
