import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  File01Icon,
} from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClearWorkerLogs, useWorkerLogs } from "@/hooks/use-worker-logs";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

interface WorkerLogDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  workerName: string;
}

function WorkerLogBody({
  isLoading,
  errorMessage,
  isEmpty,
  content,
  onRetry,
}: {
  isLoading: boolean;
  errorMessage: string | null;
  isEmpty: boolean;
  content: string;
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

  return (
    <pre className="flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-4 font-mono text-foreground text-xs leading-relaxed dark:bg-muted/10">
      {content}
    </pre>
  );
}

function WorkerLogToolbar({
  activeTab,
  onSelectTab,
  isLoading,
  isEmpty,
  clearPending,
  copied,
  confirmClear,
  onCopy,
  onRefresh,
  onClear,
}: {
  activeTab: "stdout" | "stderr";
  onSelectTab: (tab: "stdout" | "stderr") => void;
  isLoading: boolean;
  isEmpty: boolean;
  clearPending: boolean;
  copied: boolean;
  confirmClear: boolean;
  onCopy: () => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        className={cn(
          "rounded-md px-3 py-1.5 font-medium text-xs transition-colors",
          activeTab === "stdout"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        )}
        onClick={() => onSelectTab("stdout")}
        type="button"
      >
        Stdout
      </button>
      <button
        className={cn(
          "rounded-md px-3 py-1.5 font-medium text-xs transition-colors",
          activeTab === "stderr"
            ? "bg-destructive text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        )}
        onClick={() => onSelectTab("stderr")}
        type="button"
      >
        Stderr
      </button>
      <Button
        className="ml-auto text-xs"
        disabled={isLoading || isEmpty || clearPending}
        onClick={onCopy}
        size="sm"
        type="button"
        variant="outline"
      >
        {copied ? (
          <CheckmarkCircle01Icon
            aria-hidden
            className="mr-1 size-3 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <Copy01Icon aria-hidden className="mr-1 size-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button
        className="text-xs"
        disabled={isLoading || clearPending}
        onClick={onRefresh}
        size="sm"
        type="button"
        variant="outline"
      >
        Refresh
      </Button>
      <Button
        className="text-destructive text-xs hover:bg-destructive/10 hover:text-destructive"
        disabled={isLoading || clearPending}
        onClick={onClear}
        size="sm"
        type="button"
        variant="outline"
      >
        <Delete02Icon aria-hidden className="mr-1 size-3" />
        {confirmClear ? "Confirm?" : "Clear"}
      </Button>
    </div>
  );
}

export function WorkerLogDialog({
  workerName,
  open,
  onOpenChange,
}: WorkerLogDialogProps) {
  const { data, error, isLoading, refetch } = useWorkerLogs(workerName, 500);
  const clearLogs = useClearWorkerLogs(workerName);
  const [activeTab, setActiveTab] = useState<"stdout" | "stderr">("stdout");
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorMessage = error ? formatError(error) : null;
  const clearErrorMessage = clearLogs.error
    ? formatError(clearLogs.error)
    : null;

  const content =
    activeTab === "stdout" ? (data?.stdout ?? "") : (data?.stderr ?? "");
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
      void refetch();
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

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        <DialogHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <File01Icon aria-hidden className="size-4 text-muted-foreground" />
            <DialogTitle className="text-base">
              {workerName} worker logs
            </DialogTitle>
          </div>
        </DialogHeader>

        <WorkerLogToolbar
          activeTab={activeTab}
          clearPending={clearLogs.isPending}
          confirmClear={confirmClear}
          copied={copied}
          isEmpty={isEmpty}
          isLoading={isLoading}
          onClear={() => void handleClearLogs()}
          onCopy={() => void copyLogs()}
          onRefresh={() => {
            setConfirmClear(false);
            void refetch().then(() => setCopied(false));
          }}
          onSelectTab={selectTab}
        />

        {clearErrorMessage ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-destructive text-sm">
            Failed to clear logs: {clearErrorMessage}
          </div>
        ) : null}

        <WorkerLogBody
          content={content}
          errorMessage={errorMessage}
          isEmpty={isEmpty}
          isLoading={isLoading}
          onRetry={() => void refetch()}
        />
      </DialogContent>
    </Dialog>
  );
}
