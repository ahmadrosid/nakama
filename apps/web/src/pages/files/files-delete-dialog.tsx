import type { ArtifactFile } from "@nakama/core/contract";
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

export function FilesDeleteDialog({
  deleteTarget,
  deletePending,
  onClose,
  onConfirm,
}: {
  deleteTarget: ArtifactFile | null;
  deletePending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      open={deleteTarget !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete artifact</DialogTitle>
          <DialogDescription>
            Remove {deleteTarget?.filename} from this profile?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={deletePending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {deletePending ? <Spinner className="size-4" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
