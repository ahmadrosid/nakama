import type { DataImportPreviewResponse } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import { Alert02Icon, Download04Icon, Upload04Icon } from "hugeicons-react";
import type { ReactNode, SVGProps } from "react";
import { useRef, useState } from "react";
import {
  DataImportPreview,
  PendingIcon,
} from "@/components/data-portability/DataImportPreview";
import {
  TransferProgressBar,
  useTransferProgress,
} from "@/components/data-portability/TransferProgress";
import {
  canRestoreDataImport,
  useBackupStatusQuery,
  useExportData,
  usePreviewDataImport,
  useRestoreDataImport,
} from "@/hooks/use-data-portability";
import { formatError } from "@/lib/client";

/** Trigger a browser download for an in-memory archive. */
function downloadArchive(filename: string, data: ArrayBuffer): void {
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

const DownloadIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <Download04Icon className={className} />
);

const UploadIcon = ({ className }: SVGProps<SVGSVGElement>) => (
  <Upload04Icon className={className} />
);

export function DataPortabilityPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [preview, setPreview] = useState<DataImportPreviewResponse | null>(
    null
  );

  const [error, setError] = useState<string | null>(null);
  const backupStatus = useBackupStatusQuery();
  const lastBackupError = backupStatus.data?.lastError;
  const exportMutation = useExportData();
  const previewMutation = usePreviewDataImport();
  const restoreMutation = useRestoreDataImport();
  // One per section, so each bar shows only under the action that started it.
  const download = useTransferProgress();
  const upload = useTransferProgress();

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
    // The server zips everything before the first byte, so that wait gets a label.
    download.begin("Preparing the backup on the server");

    try {
      const result = await exportMutation.mutateAsync(
        download.track("Downloading the backup")
      );

      downloadArchive(result.filename, result.data);
      toast("Export ready.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      download.clear();
    }
  }

  async function handlePreview(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setError(null);

    if (!file) {
      return;
    }

    upload.begin("Uploading the backup");

    try {
      setPreview(
        await previewMutation.mutateAsync({
          file,
          onProgress: upload.track(
            "Uploading the backup",
            "Checking the backup"
          ),
        })
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      upload.clear();
    }
  }

  async function handleRestore() {
    if (!(selectedFile && preview)) {
      return;
    }

    setError(null);
    upload.begin("Uploading the backup");

    try {
      await restoreMutation.mutateAsync({
        confirm: true,
        file: selectedFile,
        onProgress: upload.track("Uploading the backup", "Restoring the files"),
      });
      toast("Backup restored.");
      setPreview(null);
      setSelectedFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      upload.clear();
    }
  }

  return (
    <div className="min-w-0 divide-y divide-border">
      {lastBackupError ? (
        <PanelError>
          Last scheduled backup failed on{" "}
          {new Date(lastBackupError.at).toLocaleString()}:{" "}
          {lastBackupError.message}
        </PanelError>
      ) : null}
      {backupStatus.isError ? (
        <PanelError>Cannot check the last scheduled backup.</PanelError>
      ) : null}
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
        {download.transfer ? (
          <div className="basis-full">
            <TransferProgressBar {...download.transfer} />
          </div>
        ) : null}
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
            accept=".zip,.enc,application/zip"
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

        {upload.transfer ? <TransferProgressBar {...upload.transfer} /> : null}

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

      {error ? <PanelError>{error}</PanelError> : null}
    </div>
  );
}

function PanelError({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div
        role="alert"
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
          "border-destructive/30 bg-destructive/10 text-destructive"
        )}
      >
        <Alert02Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="text-pretty">{children}</span>
      </div>
    </div>
  );
}
