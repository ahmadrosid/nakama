import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  File01Icon,
  MoreHorizontalIcon,
  Refresh01Icon,
} from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
import { useClearWorkerLogs, useWorkerLogs } from "@/hooks/use-worker-logs";
import { formatError } from "@/lib/client";
import { collapseRepeats, parseWorkerLog } from "@/pages/worker-logs.shared";

interface WorkerLogDrawerProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workerName: string;
}

function tabLogContent(
  activeTab: "stdout" | "stderr",
  data: { stderr?: string; stdout?: string } | undefined
): string {
  if (activeTab === "stdout") {
    return data?.stdout ?? "";
  }

  return data?.stderr ?? "";
}

function useWorkerLogDrawer(
  workerName: string,
  open: boolean,
  onOpenChange: (open: boolean) => void
) {
  const { data, error, isLoading, refetch } = useWorkerLogs(
    workerName,
    500,
    open
  );

  const clearLogs = useClearWorkerLogs(workerName);
  const [activeTab, setActiveTab] = useState<"stdout" | "stderr">("stdout");
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorMessage = error ? formatError(error) : null;

  const clearErrorMessage = clearLogs.error
    ? formatError(clearLogs.error)
    : null;

  const content = tabLogContent(activeTab, data);
  const isEmpty = !(isLoading || errorMessage) && content.length === 0;

  function selectTab(tab: "stdout" | "stderr") {
    setActiveTab(tab);
    setCopied(false);
    setConfirmClear(false);
  }

  async function copyLogs() {
    if (!content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);

      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      // Clipboard may be unavailable outside secure contexts.
    }
  }

  async function handleClearLogs() {
    if (!confirmClear) {
      setConfirmClear(true);

      return;
    }

    try {
      await clearLogs.mutateAsync();
      setCopied(false);
      setConfirmClear(false);
      await refetch();
    } catch {
      // Error surface via clearLogs.error
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCopied(false);
      setConfirmClear(false);
    }

    onOpenChange(nextOpen);
  }

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  return {
    activeTab,
    clearErrorMessage,
    clearPending: clearLogs.isPending,
    confirmClear,
    content,
    copied,
    copyLogs,
    errorMessage,
    handleClearLogs,
    handleOpenChange,
    isEmpty,
    isLoading,
    refetch,
    selectTab,
    setConfirmClear,
    setCopied,
  };
}

type LogLevelFilter = "all" | "info" | "other";

function isInfo(level: string | null): boolean {
  return level === "INFO";
}

function WorkerLogToolbar({
  activeTab,
  clearPending,
  confirmClear,
  copied,
  filter,
  isEmpty,
  isLoading,
  onClear,
  onCopy,
  onFilterChange,
  onRefresh,
  onSelectTab,
}: {
  activeTab: "stdout" | "stderr";
  clearPending: boolean;
  confirmClear: boolean;
  copied: boolean;
  filter: string;
  isEmpty: boolean;
  isLoading: boolean;
  onClear: () => void;
  onCopy: () => void;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  onSelectTab: (tab: "stdout" | "stderr") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg bg-muted p-0.5">
        {(["stdout", "stderr"] as const).map((tab) => (
          <button
            className={cn(
              "rounded-md px-3 py-1.5 font-medium text-xs capitalize transition-colors",
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={tab}
            onClick={() => onSelectTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>
      <Input
        aria-label="Filter logs"
        className="min-w-0 flex-1"
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder="Filter"
        value={filter}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Log actions"
              size="icon"
              type="button"
              variant="outline"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={isLoading || isEmpty || clearPending}
            onClick={onCopy}
          >
            {copied ? (
              <CheckmarkCircle01Icon
                aria-hidden
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
              />
            ) : (
              <Copy01Icon aria-hidden className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLoading || clearPending}
            onClick={onRefresh}
          >
            <Refresh01Icon aria-hidden className="size-3.5" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            closeOnClick={confirmClear}
            disabled={isLoading || clearPending}
            onClick={onClear}
          >
            <Delete02Icon aria-hidden className="size-3.5" />
            {confirmClear ? "Confirm?" : "Clear"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function LevelChips({
  counts,
  onChange,
  value,
}: {
  counts: Record<LogLevelFilter, number>;
  onChange: (value: LogLevelFilter) => void;
  value: LogLevelFilter;
}) {
  const chips: { id: LogLevelFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "info", label: "Info" },
    { id: "other", label: "Other" },
  ];

  return (
    <div className="flex gap-2">
      {chips.map((chip) => (
        <button
          aria-pressed={value === chip.id}
          className={cn(
            "rounded-full px-3 py-1 font-medium text-xs transition-colors",
            value === chip.id
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
          key={chip.id}
          onClick={() => onChange(chip.id)}
          type="button"
        >
          {chip.label} {counts[chip.id]}
        </button>
      ))}
    </div>
  );
}

function WorkerLogPane({
  activeTab,
  content,
  errorMessage,
  filter,
  isEmpty,
  isLoading,
  level,
  onRetry,
}: {
  activeTab: "stdout" | "stderr";
  content: string;
  errorMessage: string | null;
  filter: string;
  isEmpty: boolean;
  isLoading: boolean;
  level: LogLevelFilter;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
        <p className="text-destructive text-sm">
          Failed to load logs: {errorMessage}
        </p>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Try again
        </Button>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-md border border-border border-dashed bg-muted/15 px-4 py-3">
        <p className="font-medium text-muted-foreground text-sm">
          No log output
        </p>
        <p className="text-muted-foreground text-xs">
          The log file is empty or the worker has not produced any output yet.
        </p>
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();

  const rows = collapseRepeats(
    parseWorkerLog(content).filter(
      (row) =>
        (level === "all" || isInfo(row.level) === (level === "info")) &&
        (!needle || row.message.toLowerCase().includes(needle))
    )
  );

  const hasTime = rows.some((row) => row.time);
  const occurrences = new Map<string, number>();

  return (
    <div className="min-h-64 flex-1 overflow-auto">
      {rows.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">No matching lines</p>
      ) : null}
      {rows.map((row) => {
        const identity = JSON.stringify([row.time, row.level, row.message]);
        const occurrence = occurrences.get(identity) ?? 0;

        occurrences.set(identity, occurrence + 1);

        return (
          <div
            className="flex items-start gap-2.5 border-border/60 border-b px-1 py-1.5 last:border-b-0"
            key={`${identity}-${occurrence}`}
          >
            {hasTime ? (
              <span className="w-12 shrink-0 pt-0.5 font-mono text-muted-foreground text-xs">
                {row.time?.slice(0, 5)}
              </span>
            ) : null}
            <span
              className={cn(
                "w-11 shrink-0 rounded-md px-1.5 py-0.5 text-center font-semibold text-[11px] tracking-wide",
                isInfo(row.level)
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {row.level ?? (activeTab === "stderr" ? "ERR" : "OUT")}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words font-mono text-foreground text-xs leading-snug">
              {row.message}
            </span>
            {row.count > 1 ? (
              <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
                ×{row.count}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function WorkerLogDrawer({
  workerName,
  open,
  onOpenChange,
}: WorkerLogDrawerProps) {
  const log = useWorkerLogDrawer(workerName, open, onOpenChange);
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const rows = parseWorkerLog(log.content);
  const infoCount = rows.filter((row) => isInfo(row.level)).length;

  const counts = {
    all: rows.length,
    info: infoCount,
    other: rows.length - infoCount,
  };

  return (
    <Dialog onOpenChange={log.handleOpenChange} open={open}>
      <DialogContent className="data-closed:slide-out-to-right data-open:slide-in-from-right data-closed:zoom-out-100 data-open:zoom-in-100 top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-full translate-x-0 translate-y-0 flex-col gap-4 rounded-none p-4 transition-[opacity,transform,translate,scale] duration-200 sm:max-w-xl sm:gap-6 sm:p-6">
        <DialogHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <File01Icon aria-hidden className="size-4 text-muted-foreground" />
            <DialogTitle className="text-base">
              {workerName} worker logs
            </DialogTitle>
          </div>
        </DialogHeader>

        <WorkerLogToolbar
          activeTab={log.activeTab}
          clearPending={log.clearPending}
          confirmClear={log.confirmClear}
          copied={log.copied}
          filter={filter}
          isEmpty={log.isEmpty}
          isLoading={log.isLoading}
          onClear={() => void log.handleClearLogs()}
          onCopy={() => void log.copyLogs()}
          onFilterChange={setFilter}
          onRefresh={() => {
            log.setConfirmClear(false);
            void log.refetch().then(() => log.setCopied(false));
          }}
          onSelectTab={log.selectTab}
        />

        <LevelChips counts={counts} onChange={setLevel} value={level} />

        {log.clearErrorMessage ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-destructive text-sm">
            Failed to clear logs: {log.clearErrorMessage}
          </div>
        ) : null}

        <WorkerLogPane
          activeTab={log.activeTab}
          content={log.content}
          errorMessage={log.errorMessage}
          filter={filter}
          isEmpty={log.isEmpty}
          isLoading={log.isLoading}
          level={level}
          onRetry={() => void log.refetch()}
        />
      </DialogContent>
    </Dialog>
  );
}
