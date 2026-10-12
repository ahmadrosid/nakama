import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
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
import { WorkerLogDrawer } from "@/components/WorkerLogDrawer";
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

function ToolbarButton({
  busy = false,
  destructive = false,
  disabled,
  icon,
  label,
  onClick,
}: {
  busy?: boolean;
  destructive?: boolean;
  disabled: boolean;
  icon: ActionIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-busy={busy}
      className={cn(
        "px-4 text-sm",
        destructive &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive"
      )}
      disabled={disabled}
      onClick={onClick}
      size="lg"
      type="button"
      variant="outline"
    >
      {busy ? <ActionGlyph busy icon={icon} /> : null}
      {label}
    </Button>
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
  disabled,
  onRestart,
  onStop,
  restarting,
  stopping,
}: {
  disabled: boolean;
  onRestart: () => void;
  onStop: () => void;
  restarting: boolean;
  stopping: boolean;
}) {
  return (
    <>
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
      className={compact ? "px-4 text-sm" : undefined}
      disabled={disabled}
      onClick={onStart}
      size={compact ? "lg" : "sm"}
      type="button"
      variant={compact ? "default" : "outline"}
    >
      {compact && !starting ? null : (
        <ActionGlyph
          busy={starting}
          icon={PlayIcon}
          iconClassName="translate-x-px"
        />
      )}
      Start
    </Button>
  );
}

function ViewLogsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      className="ml-auto"
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
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
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const ownerProfileId = useChannelProfileId();
  const disconnect = useDisconnectChannel();
  const startWorker = useStartWorker();
  const stopWorker = useStopWorker();
  const restartWorker = useRestartWorker();

  const starting = startWorker.isPending;
  const stopping = stopWorker.isPending;
  const restarting = restartWorker.isPending;
  const isBusy = starting || stopping || restarting || disconnect.isPending;

  const channelName = workerName.charAt(0).toUpperCase() + workerName.slice(1);

  const disconnectWorker = () =>
    disconnect.mutate(workerName, {
      onError: (error) => toast(error.message),
    });

  if (!pm2Managed) {
    return <Pm2Unavailable className={className} error={pm2Error} />;
  }

  const toolbar = (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {running ? (
        <ToolbarButton
          busy={restarting}
          disabled={isBusy}
          icon={Rotate02Icon}
          label="Restart"
          onClick={() => restartWorker.mutate(workerName)}
        />
      ) : (
        <StartAction
          compact
          disabled={isBusy}
          onStart={() =>
            startWorker.mutate(workerName, {
              onError: (error) => toast(error.message),
            })
          }
          starting={starting}
        />
      )}
      {showLogs ? (
        <ToolbarButton
          disabled={false}
          icon={ScrollIcon}
          label="View logs"
          onClick={() => setLogDrawerOpen(true)}
        />
      ) : null}
      {ownerProfileId ? (
        <ToolbarButton
          destructive
          disabled={isBusy}
          icon={StopIcon}
          label="Disconnect"
          onClick={() => setConfirmDisconnect(true)}
        />
      ) : null}
    </div>
  );

  return (
    <>
      {compact ? (
        toolbar
      ) : (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
          {running ? (
            <RunningActions
              disabled={isBusy}
              onRestart={() => restartWorker.mutate(workerName)}
              onStop={() => stopWorker.mutate(workerName)}
              restarting={restarting}
              stopping={stopping}
            />
          ) : (
            <StartAction
              compact={false}
              disabled={isBusy}
              onStart={() =>
                startWorker.mutate(workerName, {
                  onError: (error) => toast(error.message),
                })
              }
              starting={starting}
            />
          )}
          {ownerProfileId ? (
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
            <ViewLogsButton onClick={() => setLogDrawerOpen(true)} />
          ) : null}
        </div>
      )}
      {showLogs ? (
        <WorkerLogDrawer
          onOpenChange={setLogDrawerOpen}
          open={logDrawerOpen}
          workerName={workerName}
        />
      ) : null}
      {confirmDisconnect ? (
        <ConfirmDialog
          confirmLabel="Disconnect"
          description={`Nobody can message this agent on ${channelName} until you connect it again.`}
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={() => disconnect.mutateAsync(workerName)}
          title={`Disconnect ${channelName}?`}
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
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);

  return (
    <>
      <Button
        className={cn("text-muted-foreground", className)}
        onClick={() => setLogDrawerOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ScrollIcon aria-hidden className="size-3.5" strokeWidth={2} />
        View logs
      </Button>
      <WorkerLogDrawer
        onOpenChange={setLogDrawerOpen}
        open={logDrawerOpen}
        workerName={workerName}
      />
    </>
  );
}
