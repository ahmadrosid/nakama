import type { DataImportPreviewResponse } from "@nakama/core/contract";
import { AlertTriangleIcon, DownloadIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  DataImportPreview,
  PendingIcon,
} from "@/components/data-portability/DataImportPreview";
import { Button } from "@/components/ui/button";
import {
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
      toast("Backup restored.");
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
    <div className="min-w-0 divide-y divide-border">
      <section className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-balance text-sm font-medium text-foreground">Download backup</p>
        <Button type="button" size="sm" onClick={handleExport} disabled={isBusy}>
          <PendingIcon pending={exportMutation.isPending} idle={DownloadIcon} />
          Download
        </Button>
      </section>

      <section className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-balance text-sm font-medium text-foreground">Restore from backup</p>
          <Button
            type="button"
            size="sm"
            variant={selectedFile ? "outline" : "default"}
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            <PendingIcon pending={previewMutation.isPending} idle={UploadIcon} />
            {selectedFile ? "Choose a different file" : "Choose backup file"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            disabled={isBusy}
            className="sr-only"
            aria-label="Choose a backup file"
            onChange={(event) => void handlePreview(event.target.files?.[0] ?? null)}
          />
        </div>

        {selectedFile ? (
          <DataImportPreview
            fileName={selectedFile.name}
            preview={preview}
            inspecting={previewMutation.isPending}
            restorePending={restoreMutation.isPending}
            restoreDisabled={!restoreAvailable}
            onRestore={() => void handleRestore()}
            showTopLevelPaths
          />
        ) : null}
      </section>

      {error ? (
        <div className="px-4 py-3">
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-pretty">{error}</span>
          </div>
        </div>
      ) : null}
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
