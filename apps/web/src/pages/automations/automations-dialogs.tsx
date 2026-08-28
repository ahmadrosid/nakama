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
  | "profiles"
  | "profilesLoading"
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
  profiles,
  profilesLoading,
}: AutomationsDialogsProps) {
  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setEditDraft(null);
          }
        }}
        open={editDraft !== null}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {editDraft ? (
            <>
              <DialogHeader className="gap-2 border-border border-b px-6 py-5">
                <DialogTitle>Edit automation</DialogTitle>
                <DialogDescription>{editDraft.name}</DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <AutomationEditorForm
                  automation={editDraft}
                  busy={busy}
                  onChange={updateEditDraft}
                  profiles={profiles}
                  profilesLoading={profilesLoading}
                />
              </div>

              <DialogFooter className="mx-0 mb-0 shrink-0 gap-2 border-border border-t bg-muted/30 px-6 py-5 sm:flex-row sm:justify-end">
                <Button
                  disabled={busy}
                  onClick={() => setEditDraft(null)}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  disabled={busy || profilesLoading || profiles.length === 0}
                  onClick={() => void handleSaveEdit()}
                  type="button"
                >
                  {busy ? <Spinner className="size-4" /> : "Save"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete automation?</DialogTitle>
            <DialogDescription>
              This removes{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>{" "}
              and its run history permanently.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
              type="button"
              variant="destructive"
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleteRunTarget(null);
          }
        }}
        open={deleteRunTarget !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete run history item?</DialogTitle>
            <DialogDescription>
              This permanently removes the run from{" "}
              <span className="font-medium text-foreground">
                {deleteRunTarget
                  ? formatSessionTimestamp(deleteRunTarget.startedAt)
                  : ""}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => setDeleteRunTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleDeleteRunConfirm()}
              type="button"
              variant="destructive"
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
