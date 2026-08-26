import { CloudUploadIcon } from "hugeicons-react";
import { useState } from "react";
import { PendingIcon } from "@/components/data-portability/DataImportPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExportProfilePackMutation } from "@/hooks/use-profile-pack";
import { formatError } from "@/lib/client";
import { downloadArchive } from "@/lib/download-archive";
import { toast } from "@/lib/toast";

export function ExportProfileButton({
  profileId,
  profileName,
  disabled,
}: {
  profileId: string;
  profileName: string;
  disabled?: boolean;
}) {
  const exportMutation = useExportProfilePackMutation();
  const [open, setOpen] = useState(false);

  async function handleExport() {
    try {
      const result = await exportMutation.mutateAsync(profileId);
      downloadArchive(result.filename, result.data);
      setOpen(false);
      toast("Profile pack ready.");
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <>
      <Button
        aria-label="Export profile"
        className="self-center"
        disabled={disabled || exportMutation.isPending}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <PendingIcon
          idle={CloudUploadIcon}
          pending={exportMutation.isPending}
        />
        <span>Export</span>
      </Button>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!exportMutation.isPending) {
            setOpen(nextOpen);
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
              onClick={() => setOpen(false)}
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
    </>
  );
}
