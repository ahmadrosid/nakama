import type { DataImportPreviewResponse } from "@nakama/core/contract";
import {
  AlertTriangleIcon,
  DatabaseBackupIcon,
  DownloadIcon,
  FileArchiveIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="space-y-0">
      <section className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <DatabaseBackupIcon className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Export local data</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Download a ZIP backup of the configured Nakama data root.
              </p>
            </div>
          </div>
          <Button type="button" onClick={handleExport} disabled={isBusy}>
            {exportMutation.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <DownloadIcon className="size-4" aria-hidden />
            )}
            Export ZIP
          </Button>
        </div>
      </section>

      <section className="p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <FileArchiveIcon className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Import from ZIP</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Preview an export before replacing the current local data root.
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <Input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={isBusy}
              onChange={(event) => void handlePreview(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!selectedFile || previewMutation.isPending || isBusy}
              onClick={() => void handlePreview(selectedFile)}
            >
              {previewMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <UploadIcon className="size-4" aria-hidden />
              )}
              Preview
            </Button>
          </div>

          {error ? (
            <StatusMessage tone="danger" icon={AlertTriangleIcon}>
              {error}
            </StatusMessage>
          ) : null}

          {preview ? (
            <div className="rounded-md border border-border bg-background">
              <dl className="grid gap-px overflow-hidden rounded-md bg-border text-sm sm:grid-cols-2 lg:grid-cols-4">
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
                <p className="text-sm text-muted-foreground">
                  Top-level paths: {preview.topLevelPaths.join(", ") || "none"}
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!restoreAvailable}
                  onClick={handleRestore}
                >
                  {restoreMutation.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <RotateCcwIcon className="size-4" aria-hidden />
                  )}
                  Restore ZIP
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
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
