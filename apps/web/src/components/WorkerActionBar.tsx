import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import {
  Loading03Icon,
  PlayIcon,
  Rotate02Icon,
  ScrollIcon,
  StopIcon,
} from "hugeicons-react";
import { useState } from "react";
import { WorkerLogDialog } from "@/components/WorkerLogDialog";
import { useChannelProfileId } from "@/hooks/use-app-queries";
import {
  useDisconnectChannel,
  useRestartWorker,
  useStartWorker,
  useStopWorker,
} from "@/hooks/use-worker-actions";

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

function WorkerActionsMenu({
  busy,
  running,
  showLogs,
  onAction,
  onViewLogs,
}: {
  busy: boolean;
  running: boolean;
  showLogs: boolean;
  onAction: () => void;
  onViewLogs: () => void;
}) {
  if (!(running || showLogs)) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button disabled={busy} size="sm" variant="outline" />}
      >
        {busy ? "Working…" : "More"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {running ? (
          <DropdownMenuItem onClick={onAction}>Restart</DropdownMenuItem>
        ) : null}
        {showLogs ? (
          <DropdownMenuItem onClick={onViewLogs}>View logs</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkerActionBar({
  running,
  pm2Managed,
  workerName,
  className,
  showLogs = true,
  compact = false,
}: {
  running: boolean;
  pm2Managed: boolean;
  workerName: string;
  className?: string;
  showLogs?: boolean;
  compact?: boolean;
}) {
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const ownerProfileId = useChannelProfileId();
  const disconnect = useDisconnectChannel();
  const startWorker = useStartWorker();
  const stopWorker = useStopWorker();
  const restartWorker = useRestartWorker();

  const starting = startWorker.isPending;
  const stopping = stopWorker.isPending;
  const restarting = restartWorker.isPending;
  const isBusy = starting || stopping || restarting || disconnect.isPending;

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
          compact ? null : (
            <>
              <Button
                aria-busy={stopping}
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
                aria-busy={restarting}
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
          )
        ) : (
          <Button
            aria-busy={starting}
            disabled={isBusy}
            onClick={() =>
              startWorker.mutate(workerName, {
                onError: (error) => toast(error.message),
              })
            }
            size="sm"
            type="button"
            variant={compact ? "default" : "outline"}
          >
            <ActionGlyph
              busy={starting}
              icon={PlayIcon}
              iconClassName="translate-x-px"
            />
            Start
          </Button>
        )}
        {ownerProfileId ? (
          <Button
            disabled={isBusy}
            onClick={() =>
              disconnect.mutate(workerName, {
                onError: (error) => toast(error.message),
              })
            }
            size="sm"
            variant="ghost"
          >
            Disconnect
          </Button>
        ) : null}
        {compact ? (
          <WorkerActionsMenu
            busy={isBusy}
            onAction={() => {
              const mutation = running ? restartWorker : startWorker;
              mutation.mutate(workerName, {
                onError: (error) => toast(error.message),
              });
            }}
            onViewLogs={() => setLogDialogOpen(true)}
            running={running}
            showLogs={showLogs}
          />
        ) : showLogs ? (
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
