import type { SoulFileStatus, SoulStackFiles } from "@nakama/core/contract";
import { FileTextIcon, FolderIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

export function SoulFileEditorDialog({
  open,
  openFileMeta,
  isWritable,
  dialogLoading,
  dialogError,
  editContent,
  busy,
  isDirty,
  status,
  openFile,
  onOpenChange,
  onEditContentChange,
  onSave,
}: {
  open: boolean;
  openFileMeta: {
    label: string;
    description: string;
    writable: boolean;
  } | null | undefined;
  isWritable: boolean;
  dialogLoading: boolean;
  dialogError: string | null;
  editContent: string;
  busy: boolean;
  isDirty: boolean;
  status: { files: SoulFileStatus } | null;
  openFile: keyof SoulStackFiles | null;
  onOpenChange: (open: boolean) => void;
  onEditContentChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex min-h-[min(82dvh,38rem)] max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        <DialogHeader className="gap-2 pr-8 sm:gap-3">
          <DialogTitle className="flex items-center gap-2 font-mono text-base">
            {openFileMeta?.writable ? (
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {openFileMeta?.label}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {openFileMeta?.description}
            {!isWritable ? " Read-only in the UI." : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {dialogError ? (
            <p className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {dialogError}
            </p>
          ) : null}

          {dialogLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading file content…
            </div>
          ) : (
            <>
              {openFile && status && !status.files[openFile] && !editContent ? (
                <p className="shrink-0 text-sm leading-relaxed text-muted-foreground">
                  This file is missing. Start writing — it will be created when you save.
                </p>
              ) : null}

              <Textarea
                className="field-sizing-fixed min-h-[min(52dvh,22rem)] flex-1 resize-none overflow-y-auto font-mono text-xs leading-relaxed sm:min-h-[min(58dvh,26rem)]"
                value={editContent}
                readOnly={!isWritable || dialogLoading}
                disabled={busy || dialogLoading}
                placeholder={
                  isWritable
                    ? `Write ${openFileMeta?.label ?? "file"} content…`
                    : "Examples are loaded from markdown files under examples/."
                }
                onChange={(event) => onEditContentChange(event.target.value)}
              />

              {isWritable && isDirty ? (
                <p className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Unsaved changes
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col-reverse gap-3 border-t border-border bg-transparent p-0 pt-4 sm:flex-row sm:justify-end sm:pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {isWritable ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={busy || dialogLoading || !isDirty}
              onClick={onSave}
            >
              {busy ? <Spinner className="size-4" /> : "Save file"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
