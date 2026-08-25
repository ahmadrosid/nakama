import type { ProfilePackPreviewResponse } from "@nakama/core/contract";
import { useRef, useState } from "react";
import { ProfilePackImportPreview } from "@/components/profiles/ProfilePackImportPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  canConfirmProfilePackImport,
  useImportProfilePackMutation,
  usePreviewProfilePackImportMutation,
} from "@/hooks/use-profile-pack";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

interface ProfileImportDialogProps {
  onImported: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function ProfileImportDialog({
  onImported,
  onOpenChange,
  open,
}: ProfileImportDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <ProfileImportDialogContent
          onImported={onImported}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function ProfileImportDialogContent({
  onImported,
  onOpenChange,
}: {
  onImported: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProfilePackPreviewResponse | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewMutation = usePreviewProfilePackImportMutation();
  const importMutation = useImportProfilePackMutation();
  const busy = previewMutation.isPending || importMutation.isPending;
  const confirmEnabled = canConfirmProfilePackImport({
    hasPreviewError: Boolean(previewError),
    pending: busy,
    previewReady: Boolean(preview),
    selectedFile,
  });

  async function handleFileSelected(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setPreviewError(null);

    if (!file) {
      return;
    }

    try {
      setPreview(await previewMutation.mutateAsync(file));
    } catch (err) {
      setPreviewError(formatError(err));
    }
  }

  async function handleConfirm() {
    if (!(selectedFile && preview)) {
      return;
    }

    try {
      const response = await importMutation.mutateAsync({
        file: selectedFile,
      });
      toast(`Imported "${response.manifest.meta.name}".`);
      onOpenChange(false);
      onImported(response.profileId);
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <DialogContent className="flex max-h-[min(90dvh,42rem)] flex-col gap-6 overflow-hidden p-6 sm:max-w-lg">
      <DialogHeader className="gap-2">
        <DialogTitle>Import profile</DialogTitle>
        <DialogDescription>
          Upload a profile pack (.zip) exported from Nakama.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <Button
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          type="button"
          variant={selectedFile ? "outline" : "default"}
        >
          {selectedFile ? "Choose a different file" : "Choose profile pack"}
        </Button>
        <input
          accept=".zip,application/zip"
          aria-label="Choose a profile pack file"
          className="sr-only"
          disabled={busy}
          onChange={(event) =>
            void handleFileSelected(event.target.files?.[0] ?? null)
          }
          ref={inputRef}
          type="file"
        />

        {selectedFile ? (
          <ProfilePackImportPreview
            error={previewError}
            fileName={selectedFile.name}
            inspecting={previewMutation.isPending}
            preview={preview}
          />
        ) : null}
      </div>

      <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
        <Button
          disabled={busy}
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={!confirmEnabled}
          onClick={() => void handleConfirm()}
          type="button"
        >
          {importMutation.isPending ? (
            <Spinner className="size-4" />
          ) : (
            "Confirm"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
