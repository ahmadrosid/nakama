import {
  Loading03Icon,
  PlayIcon,
  Rotate02Icon,
  ScrollIcon,
  StopIcon,
} from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkerLogDialog } from "@/components/WorkerLogDialog";
import {
  useRestartWorker,
  useStartWorker,
  useStopWorker,
} from "@/hooks/use-worker-actions";
import { cn } from "@/lib/utils";

const glyphTransition =
  "absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]";
type ActionIcon = typeof PlayIcon;

function ActionGlyph({
  icon: Icon,
  busy,
  iconClassName,
}: {
  icon: ActionIcon;
  busy: boolean;
  iconClassName?: string;
}) {
  return (
    <span aria-hidden={!busy} className="relative size-3.5 shrink-0">
      <Icon
        aria-hidden
        className={cn(
          glyphTransition,
          busy
            ? "scale-[0.25] opacity-0 blur-[4px]"
            : "scale-100 opacity-100 blur-0",
          iconClassName
        )}
        strokeWidth={2}
      />
      <Loading03Icon
        aria-hidden={!busy}
        className={cn(
          glyphTransition,
          "animate-spin",
          busy
            ? "scale-100 opacity-100 blur-0"
            : "scale-[0.25] opacity-0 blur-[4px]"
        )}
        strokeWidth={2}
        {...(busy ? { "aria-label": "Loading", role: "status" as const } : {})}
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

  const starting =
    startWorker.isPending && startWorker.variables === workerName;
  const stopping = stopWorker.isPending && stopWorker.variables === workerName;
  const restarting =
    restartWorker.isPending && restartWorker.variables === workerName;
  const isBusy = starting || stopping || restarting;

  if (!pm2Managed) {
    return (
      <span className={cn("text-muted-foreground text-xs", className)}>
        PM2 not available
      </span>
    );
  }

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        {running ? (
          <>
            <Button
              aria-busy={stopping || undefined}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={isBusy}
              onClick={() => stopWorker.mutate(workerName)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ActionGlyph busy={stopping} icon={StopIcon} />
              Stop
            </Button>
            <Button
              aria-busy={restarting || undefined}
              disabled={isBusy}
              onClick={() => restartWorker.mutate(workerName)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ActionGlyph busy={restarting} icon={Rotate02Icon} />
              Restart
            </Button>
          </>
        ) : (
          <Button
            aria-busy={starting || undefined}
            disabled={isBusy}
            onClick={() => startWorker.mutate(workerName)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ActionGlyph
              busy={starting}
              icon={PlayIcon}
              iconClassName="translate-x-px"
            />
            Start
          </Button>
        )}
        {showLogs ? (
          <Button
            className="ml-auto"
            onClick={() => setLogDialogOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ScrollIcon aria-hidden className="size-3.5" strokeWidth={2} />
            View logs
          </Button>
        ) : null}
      </div>
      {showLogs ? (
        <WorkerLogDialog
          onOpenChange={setLogDialogOpen}
          open={logDialogOpen}
          workerName={workerName}
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
        className={cn("text-muted-foreground", className)}
        onClick={() => setLogDialogOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ScrollIcon aria-hidden className="size-3.5" strokeWidth={2} />
        View logs
      </Button>
      <WorkerLogDialog
        onOpenChange={setLogDialogOpen}
        open={logDialogOpen}
        workerName={workerName}
      />
    </>
  );
}
