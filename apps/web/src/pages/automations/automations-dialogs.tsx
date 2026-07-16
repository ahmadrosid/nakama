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
import { formatSessionTimestamp } from "@/lib/chat-history";
import { AutomationEditorForm } from "@/pages/automations/automations-components";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

type AutomationsDialogsProps = Pick<
  AutomationsPageState,
  | "busy"
  | "editDraft"
  | "setEditDraft"
  | "deleteTarget"
  | "setDeleteTarget"
  | "deleteRunTarget"
  | "setDeleteRunTarget"
  | "handleSaveEdit"
  | "handleDeleteConfirm"
  | "handleDeleteRunConfirm"
  | "updateEditDraft"
>;

export function AutomationsDialogs({
  busy,
  editDraft,
  setEditDraft,
  deleteTarget,
  setDeleteTarget,
  deleteRunTarget,
  setDeleteRunTarget,
  handleSaveEdit,
  handleDeleteConfirm,
  handleDeleteRunConfirm,
  updateEditDraft,
}: AutomationsDialogsProps) {
  return (
    <>
      <Dialog
        open={editDraft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditDraft(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {editDraft ? (
            <>
              <DialogHeader className="gap-2 border-b border-border px-6 py-5">
                <DialogTitle>Edit automation</DialogTitle>
                <DialogDescription>{editDraft.name}</DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <AutomationEditorForm
                  automation={editDraft}
                  busy={busy}
                  onChange={updateEditDraft}
                />
              </div>

              <DialogFooter className="mx-0 mb-0 shrink-0 gap-2 border-t border-border bg-muted/30 px-6 py-5 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditDraft(null)}
                >
                  Cancel
                </Button>
                <Button type="button" disabled={busy} onClick={() => void handleSaveEdit()}>
                  {busy ? <Spinner className="size-4" /> : "Save"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete automation?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>{" "}
              and its run history permanently.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteRunTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteRunTarget(null);
          }
        }}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete run history item?</DialogTitle>
            <DialogDescription>
              This permanently removes the run from{" "}
              <span className="font-medium text-foreground">
                {deleteRunTarget ? formatSessionTimestamp(deleteRunTarget.startedAt) : ""}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteRunTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDeleteRunConfirm()}
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
