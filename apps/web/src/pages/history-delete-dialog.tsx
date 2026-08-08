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
    <Dialog onOpenChange={onOpenChange} open={deleteTarget !== null}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle className="text-balance">Delete chat?</DialogTitle>
          <DialogDescription className="text-pretty">
            Deletes this chat and its{" "}
            <span className="tabular-nums">
              {deleteTarget?.messageCount ?? 0}
            </span>{" "}
            message
            {(deleteTarget?.messageCount ?? 0) === 1 ? "" : "s"} permanently.
          </DialogDescription>
          {deleteTarget ? (
            <p className="line-clamp-2 font-medium text-foreground text-sm">
              {formatSessionTitle(deleteTarget)}
            </p>
          ) : null}
        </DialogHeader>

        <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {busy ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
