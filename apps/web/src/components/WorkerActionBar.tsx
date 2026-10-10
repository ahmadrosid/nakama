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
  MoreHorizontalIcon,
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

function DisconnectMenu({
  busy,
  onDisconnect,
}: {
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="More actions"
            disabled={busy}
            size="sm"
            variant="outline"
          />
        }
      >
        <MoreHorizontalIcon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onDisconnect} variant="destructive">
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Pm2Unavailable({
  className,
  error,
}: {
  className?: string;
  error?: string;
}) {
  return (
    <span
      className={cn("text-muted-foreground text-xs", className)}
      title={error}
    >
      {error ? `PM2 not available: ${error}` : "PM2 not available"}
    </span>
  );
}

function RunningActions({
  compact,
  disabled,
  onRestart,
  onStop,
  restarting,
  stopping,
}: {
  compact: boolean;
  disabled: boolean;
  onRestart: () => void;
  onStop: () => void;
  restarting: boolean;
  stopping: boolean;
}) {
  return (
    <>
      {compact ? null : (
        <Button
          aria-busy={stopping}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={disabled}
          onClick={onStop}
          size="sm"
          type="button"
          variant="outline"
        >
          <ActionGlyph busy={stopping} icon={StopIcon} />
          Stop
        </Button>
      )}
      <Button
        aria-busy={restarting}
        disabled={disabled}
        onClick={onRestart}
        size="sm"
        type="button"
        variant="outline"
      >
        <ActionGlyph busy={restarting} icon={Rotate02Icon} />
        Restart
      </Button>
    </>
  );
}

function StartAction({
  compact,
  disabled,
  onStart,
  starting,
}: {
  compact: boolean;
  disabled: boolean;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <Button
      aria-busy={starting}
      disabled={disabled}
      onClick={onStart}
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
  );
}

function ViewLogsButton({
  compact,
  onClick,
}: {
  compact: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className={compact ? undefined : "ml-auto"}
      onClick={onClick}
      size="sm"
      type="button"
      variant={compact ? "outline" : "ghost"}
    >
      <ScrollIcon aria-hidden className="size-3.5" strokeWidth={2} />
      View logs
    </Button>
  );
}

export function WorkerActionBar({
  running,
  pm2Managed,
  pm2Error,
  workerName,
  className,
  showLogs = true,
  compact = false,
}: {
  running: boolean;
  pm2Managed: boolean;
  pm2Error?: string;
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

  const disconnectWorker = () =>
    disconnect.mutate(workerName, {
      onError: (error) => toast(error.message),
    });

  if (!pm2Managed) {
    return <Pm2Unavailable className={className} error={pm2Error} />;
  }

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        {running ? (
          <RunningActions
            compact={compact}
            disabled={isBusy}
            onRestart={() => restartWorker.mutate(workerName)}
            onStop={() => stopWorker.mutate(workerName)}
            restarting={restarting}
            stopping={stopping}
          />
        ) : (
          <StartAction
            compact={compact}
            disabled={isBusy}
            onStart={() =>
              startWorker.mutate(workerName, {
                onError: (error) => toast(error.message),
              })
            }
            starting={starting}
          />
        )}
        {ownerProfileId && !compact ? (
          <Button
            disabled={isBusy}
            onClick={disconnectWorker}
            size="sm"
            variant="ghost"
          >
            Disconnect
          </Button>
        ) : null}
        {showLogs ? (
          <ViewLogsButton
            compact={compact}
            onClick={() => setLogDialogOpen(true)}
          />
        ) : null}
        {ownerProfileId && compact ? (
          <DisconnectMenu busy={isBusy} onDisconnect={disconnectWorker} />
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
