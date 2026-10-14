import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { Cancel01Icon } from "hugeicons-react";
import { AutomationEditorForm } from "@/pages/automations/automations-components";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

type AutomationsDialogsProps = Pick<
  AutomationsPageState,
  | "busy"
  | "editDraft"
  | "setEditDraft"
  | "deleteTarget"
  | "setDeleteTarget"
  | "handleSaveEdit"
  | "handleDeleteConfirm"
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
  handleSaveEdit,
  handleDeleteConfirm,
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
        <DialogPrimitive.Portal>
          <DialogOverlay className="transition-opacity duration-200 ease-out data-closed:animate-none data-open:animate-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
          <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-border border-l bg-background text-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full motion-reduce:transition-none">
            <DialogTitle className="sr-only">Edit automation</DialogTitle>
            <DialogPrimitive.Close
              render={
                <Button
                  aria-label="Close editor"
                  className="absolute top-3 right-3 z-10 min-h-10 min-w-10"
                  disabled={busy}
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <Cancel01Icon aria-hidden className="size-5" />
            </DialogPrimitive.Close>
            {editDraft ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-6 sm:px-6 [&_input[aria-label=Name]]:pr-10">
                  <AutomationEditorForm
                    automation={editDraft}
                    busy={busy}
                    onChange={updateEditDraft}
                    profiles={profiles}
                  />
                </div>

                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-border border-t px-4 py-3 sm:px-6">
                  <label className="mr-auto flex min-h-11 items-center gap-2 text-sm sm:min-h-10">
                    <Switch
                      aria-label="Automation enabled"
                      checked={editDraft.enabled}
                      disabled={busy}
                      onCheckedChange={(enabled) =>
                        updateEditDraft({ enabled })
                      }
                    />
                    {editDraft.enabled ? "Turned on" : "Turned off"}
                  </label>
                  <Button
                    className="min-h-11 rounded-xl px-4 sm:min-h-10"
                    disabled={busy}
                    onClick={() => setEditDraft(null)}
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    className="min-h-11 rounded-xl px-4 sm:min-h-10"
                    disabled={busy || profilesLoading || profiles.length === 0}
                    onClick={() => void handleSaveEdit()}
                    type="button"
                  >
                    {busy ? <Spinner className="size-4" /> : null}
                    Save changes
                  </Button>
                </div>
              </>
            ) : null}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
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
    </>
  );
}
