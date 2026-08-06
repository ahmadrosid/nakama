import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, FileTextIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkerLogs, useClearWorkerLogs } from "@/hooks/use-worker-logs";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

interface WorkerLogDialogProps {
  workerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkerLogDialog({ workerName, open, onOpenChange }: WorkerLogDialogProps) {
  const { data, error, isLoading, refetch } = useWorkerLogs(workerName, 500);
  const clearLogs = useClearWorkerLogs(workerName);
  const [activeTab, setActiveTab] = useState<"stdout" | "stderr">("stdout");
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorMessage = error ? formatError(error) : null;
  const clearErrorMessage = clearLogs.error ? formatError(clearLogs.error) : null;

  const content = activeTab === "stdout" ? (data?.stdout ?? "") : (data?.stderr ?? "");
  const isEmpty = !isLoading && !errorMessage && content.length === 0;

  function selectTab(tab: "stdout" | "stderr") {
    setActiveTab(tab);
    setCopied(false);
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

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCopied(false);
      void refetch();
    }
    onOpenChange(nextOpen);
  }

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        <DialogHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
            <DialogTitle className="text-base">{workerName} worker logs</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => selectTab("stdout")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "stdout"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            Stdout
          </button>
          <button
            type="button"
            onClick={() => selectTab("stderr")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "stderr"
                ? "bg-destructive text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            Stderr
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto text-xs"
            disabled={isLoading || isEmpty || clearLogs.isPending}
            onClick={() => void copyLogs()}
          >
            {copied ? (
              <CheckIcon className="mr-1 size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <CopyIcon className="mr-1 size-3" aria-hidden />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={isLoading || clearLogs.isPending}
            onClick={() => void refetch().then(() => setCopied(false))}
          >
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isLoading || clearLogs.isPending}
            onClick={() => {
              if (confirm("Are you sure you want to clear the logs?")) {
                void clearLogs.mutateAsync().then(() => {
                  setCopied(false);
                  return refetch();
                });
              }
            }}
          >
            <Trash2Icon className="mr-1 size-3" aria-hidden />
            Clear
          </Button>
        </div>

        {clearErrorMessage ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            Failed to clear logs: {clearErrorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : errorMessage ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">Failed to load logs: {errorMessage}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : isEmpty ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/15 px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">No log output</p>
            <p className="text-xs text-muted-foreground">
              The log file is empty or the worker has not produced any output yet.
            </p>
          </div>
        ) : (
          <pre className="flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-4 text-xs font-mono leading-relaxed text-foreground dark:bg-muted/10">
            {content}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
