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
  const [preview, setPreview] = useState<DataImportPreviewResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const exportMutation = useExportData();
  const previewMutation = usePreviewDataImport();
  const restoreMutation = useRestoreDataImport();
  const isBusy =
    exportMutation.isPending ||
    previewMutation.isPending ||
    restoreMutation.isPending;
  const restoreAvailable = canRestoreDataImport({
    pending: restoreMutation.isPending,
    previewReady: Boolean(preview),
    selectedFile,
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
    if (!(selectedFile && preview)) {
      return;
    }

    setError(null);
    try {
      await restoreMutation.mutateAsync({ confirm: true, file: selectedFile });
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
        <p className="text-balance font-medium text-foreground text-sm">
          Download backup
        </p>
        <Button
          disabled={isBusy}
          onClick={handleExport}
          size="sm"
          type="button"
        >
          <PendingIcon idle={DownloadIcon} pending={exportMutation.isPending} />
          Download
        </Button>
      </section>

      <section className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-balance font-medium text-foreground text-sm">
            Restore from backup
          </p>
          <Button
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
            size="sm"
            type="button"
            variant={selectedFile ? "outline" : "default"}
          >
            <PendingIcon
              idle={UploadIcon}
              pending={previewMutation.isPending}
            />
            {selectedFile ? "Choose a different file" : "Choose backup file"}
          </Button>
          <input
            accept=".zip,application/zip"
            aria-label="Choose a backup file"
            className="sr-only"
            disabled={isBusy}
            onChange={(event) =>
              void handlePreview(event.target.files?.[0] ?? null)
            }
            ref={inputRef}
            type="file"
          />
        </div>

        {selectedFile ? (
          <DataImportPreview
            fileName={selectedFile.name}
            inspecting={previewMutation.isPending}
            onRestore={() => void handleRestore()}
            preview={preview}
            restoreDisabled={!restoreAvailable}
            restorePending={restoreMutation.isPending}
            showTopLevelPaths
          />
        ) : null}
      </section>

      {error ? (
        <div className="px-4 py-3">
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">{error}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function downloadArchive(filename: string, data: ArrayBuffer) {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/zip" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
