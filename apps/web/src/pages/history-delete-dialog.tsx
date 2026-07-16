import type { SessionSummary } from "@nakama/core/contract";
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
import { formatSessionTitle } from "@/pages/history-page.shared";

export function HistoryDeleteDialog({
  deleteTarget,
  busy,
  onOpenChange,
  onConfirm,
}: {
  deleteTarget: SessionSummary | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={deleteTarget !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Delete conversation?</DialogTitle>
          <DialogDescription>
            This removes {deleteTarget?.messageCount ?? 0} message
            {(deleteTarget?.messageCount ?? 0) === 1 ? "" : "s"}. This cannot be undone.
          </DialogDescription>
          {deleteTarget ? (
            <p className="text-sm font-medium text-foreground line-clamp-2">
              {formatSessionTitle(deleteTarget)}
            </p>
          ) : null}
        </DialogHeader>

        <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
