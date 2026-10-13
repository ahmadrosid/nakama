import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { toast } from "@nakama/ui/toast";
import { CloudUploadIcon } from "hugeicons-react";
import { PendingIcon } from "@/components/data-portability/DataImportPreview";
import { useExportProfilePackMutation } from "@/hooks/use-profile-pack";
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

export function ExportProfileDialog({
  profileId,
  profileName,
  onOpenChange,
  open,
}: {
  profileId: string;
  profileName: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const exportMutation = useExportProfilePackMutation();

  async function handleExport() {
    try {
      const result = await exportMutation.mutateAsync(profileId);
      downloadArchive(result.filename, result.data);
      onOpenChange(false);
      toast("Profile pack ready.");
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!exportMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Export profile?</DialogTitle>
          <DialogDescription>
            This downloads a profile pack for {profileName}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
          <Button
            disabled={exportMutation.isPending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={exportMutation.isPending}
            onClick={() => void handleExport()}
            type="button"
          >
            <PendingIcon
              idle={CloudUploadIcon}
              pending={exportMutation.isPending}
            />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
