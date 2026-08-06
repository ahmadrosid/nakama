import type { DataImportPreviewResponse } from "@nakama/core/contract";
import { AlertTriangleIcon, FileArchiveIcon, RotateCcwIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDataPortabilityBytes } from "@/hooks/use-data-portability";
import { cn } from "@/lib/utils";

interface DataImportPreviewProps {
  fileName: string;
  preview: DataImportPreviewResponse | null;
  inspecting: boolean;
  restorePending: boolean;
  restoreDisabled: boolean;
  onRestore: () => void;
  /** Admin settings may show archive roots; setup should not. */
  showTopLevelPaths?: boolean;
  restoreLabel?: string;
}

export function DataImportPreview({
  fileName,
  preview,
  inspecting,
  restorePending,
  restoreDisabled,
  onRestore,
  showTopLevelPaths = false,
  restoreLabel,
}: DataImportPreviewProps) {
  const actionLabel =
    restoreLabel ??
    (preview?.willReplaceRoot ? "Replace with this backup" : "Use this backup");

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-start gap-3 p-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <FileArchiveIcon className="size-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
          {inspecting ? (
            <p className="text-xs text-muted-foreground">Checking file…</p>
          ) : preview ? (
            <p className="text-pretty text-xs text-muted-foreground tabular-nums">
              Saved {formatDate(preview.manifest.createdAt)}
              <MetaSep />
              {preview.archiveFileCount} files
              <MetaSep />
              {formatDataPortabilityBytes(preview.archiveTotalBytes)}
            </p>
          ) : null}
        </div>
      </div>

      {preview ? (
        <div className="space-y-3 border-t border-border p-3">
          {preview.willReplaceRoot ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                "border-primary/30 bg-primary/10 text-primary",
              )}
              role="status"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="text-pretty">
                This replaces everything already set up here.
              </span>
            </div>
          ) : null}

          {showTopLevelPaths && preview.topLevelPaths.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {preview.topLevelPaths.map((path) => (
                <li
                  key={path}
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {path}
                </li>
              ))}
            </ul>
          ) : null}

          <Button
            type="button"
            className="w-full"
            disabled={restoreDisabled}
            onClick={onRestore}
          >
            <PendingIcon pending={restorePending} idle={RotateCcwIcon} />
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PendingIcon({
  pending,
  idle: IdleIcon,
}: {
  pending: boolean;
  idle: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <span className="relative size-3.5 shrink-0" aria-hidden>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          pending ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]",
        )}
      >
        <Spinner className="size-3.5" />
      </span>
      <span
        className={cn(
          "flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          pending ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0",
        )}
      >
        <IdleIcon className="size-3.5" />
      </span>
    </span>
  );
}

function MetaSep() {
  return (
    <span className="mx-1.5 text-border" aria-hidden>
      ·
    </span>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
