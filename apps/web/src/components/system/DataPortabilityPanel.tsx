import type { DataImportPreviewResponse } from "@nakama/core/contract";
import {
  AlertTriangleIcon,
  DownloadIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  formatDataPortabilityBytes,
  canRestoreDataImport,
  useExportData,
  usePreviewDataImport,
  useRestoreDataImport,
} from "@/hooks/use-data-portability";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function DataPortabilityPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DataImportPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportMutation = useExportData();
  const previewMutation = usePreviewDataImport();
  const restoreMutation = useRestoreDataImport();
  const isBusy =
    exportMutation.isPending || previewMutation.isPending || restoreMutation.isPending;
  const restoreAvailable = canRestoreDataImport({
    selectedFile,
    previewReady: Boolean(preview),
    pending: restoreMutation.isPending,
  });

  async function handleExport() {
    setError(null);
    try {
      const result = await exportMutation.mutateAsync();
      downloadArchive(result.filename, result.data);
      toast("Export ready.");
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handlePreview(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setError(null);

    if (!file) {
      return;
    }

    try {
      setPreview(await previewMutation.mutateAsync(file));
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleRestore() {
    if (!selectedFile || !preview) {
      return;
    }

    setError(null);
    try {
      await restoreMutation.mutateAsync({ file: selectedFile, confirm: true });
      toast("Import restored.");
      setPreview(null);
      setSelectedFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <section className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Export</p>
              <p className="text-xs text-muted-foreground">
                Download a ZIP backup of the configured Nakama data root.
              </p>
            </div>
            <Button type="button" size="sm" onClick={handleExport} disabled={isBusy}>
              {exportMutation.isPending ? (
                <Spinner className="size-3.5" />
              ) : (
                <DownloadIcon className="size-3.5" aria-hidden />
              )}
              Export ZIP
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Import</p>
              <p className="text-xs text-muted-foreground">
                Upload a ZIP backup of the configured Nakama data root to review before restoring.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              {previewMutation.isPending ? (
                <Spinner className="size-3.5" />
              ) : (
                <UploadIcon className="size-3.5" aria-hidden />
              )}
              Import ZIP
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={isBusy}
              className="sr-only"
              aria-label="Import backup ZIP file"
              onChange={(event) => void handlePreview(event.target.files?.[0] ?? null)}
            />
          </div>

          {selectedFile ? (
            <p className="text-xs text-muted-foreground">
              {previewMutation.isPending ? "Inspecting " : "Selected: "}
              <span className="font-medium text-foreground">{selectedFile.name}</span>
            </p>
          ) : null}

          {preview ? (
            <div className="rounded-md border border-border bg-background">
              <dl className="grid gap-px overflow-hidden rounded-md bg-border text-sm sm:grid-cols-2">
                <PreviewStat label="Created" value={formatDate(preview.manifest.createdAt)} />
                <PreviewStat label="Files" value={String(preview.archiveFileCount)} />
                <PreviewStat
                  label="Size"
                  value={formatDataPortabilityBytes(preview.archiveTotalBytes)}
                />
                <PreviewStat
                  label="Action"
                  value={preview.willReplaceRoot ? "Replace current data" : "Create data root"}
                />
              </dl>
              <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Top-level paths: {preview.topLevelPaths.join(", ") || "none"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!restoreAvailable}
                  onClick={handleRestore}
                >
                  {restoreMutation.isPending ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <RotateCcwIcon className="size-3.5" aria-hidden />
                  )}
                  Restore ZIP
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {error ? (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <StatusMessage tone="danger" icon={AlertTriangleIcon}>
            {error}
          </StatusMessage>
        </div>
      ) : null}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function StatusMessage({
  children,
  icon: Icon,
  tone,
}: {
  children: string;
  icon: typeof AlertTriangleIcon;
  tone: "danger";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function downloadArchive(filename: string, data: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
