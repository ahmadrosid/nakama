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
  usePreviewDataImport,
  useRestoreDataImport,
} from "@/hooks/use-data-portability";
import { client, formatError } from "@/lib/client";

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{ accept: Record<string, string[]>; description: string }>;
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

function getSaveFilePicker(): SaveFilePicker | null {
  // SAFETY: feature-detected before use; only Chromium defines it.
  return (
    (window as Window & { showSaveFilePicker?: SaveFilePicker })
      .showSaveFilePicker ?? null
  );
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

  // A failed refetch keeps old data; do not show that next to "Cannot check"
  const lastBackupError = backupStatus.isError
    ? null
    : backupStatus.data?.lastError;

  const [exporting, setExporting] = useState(false);
  const previewMutation = usePreviewDataImport();
  const restoreMutation = useRestoreDataImport();
  // One per section, so each bar shows only under the action that started it.
  const upload = useTransferProgress();

  const isBusy =
    exporting || previewMutation.isPending || restoreMutation.isPending;

  const restoreAvailable = canRestoreDataImport({
    pending: restoreMutation.isPending,
    previewReady: Boolean(preview),
    selectedFile,
  });

  async function handleExport() {
    setError(null);

    const picker = getSaveFilePicker();

    if (!picker) {
      // Browsers without the File System Access API stream the download natively.
      window.location.assign("/v1/platform/data/export");

      return;
    }

    setExporting(true);

    try {
      const handle = await picker({
        suggestedName: "nakama-export.zip",
        types: [
          {
            accept: { "application/zip": [".zip"] },
            description: "ZIP archive",
          },
        ],
      });

      const response = await client.exportDataResponse();

      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}.`);
      }

      if (!response.body) {
        throw new Error("Export returned no data.");
      }

      const writable = await handle.createWritable();

      try {
        await response.body.pipeTo(writable);
      } catch (err) {
        await writable.abort().catch(() => undefined);
        throw err;
      }

      toast("Export ready.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setExporting(false);
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
          variant="outline"
        >
          <PendingIcon idle={DownloadIcon} pending={exporting} />
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
            variant="outline"
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
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
          "border-destructive/30 bg-destructive/10 text-destructive"
        )}
        role="alert"
      >
        <Alert02Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="text-pretty">{children}</span>
      </div>
    </div>
  );
}
