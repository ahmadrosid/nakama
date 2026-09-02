import type { SoulFileStatus, SoulStackFiles } from "@nakama/core/contract";
import { File01Icon, Folder01Icon } from "hugeicons-react";
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

type SoulFileMeta =
  | {
      label: string;
      description: string;
      writable: boolean;
    }
  | null
  | undefined;

function SoulFileEditorHeader({
  isWritable,
  openFileMeta,
}: {
  isWritable: boolean;
  openFileMeta: SoulFileMeta;
}) {
  return (
    <DialogHeader className="gap-2 pr-8 sm:gap-3">
      <DialogTitle className="flex items-center gap-2 font-mono text-base">
        {openFileMeta?.writable ? (
          <File01Icon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
        ) : (
          <Folder01Icon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
        )}
        {openFileMeta?.label}
      </DialogTitle>
      <DialogDescription className="leading-relaxed">
        {openFileMeta?.description}
        {isWritable ? null : " Read-only in the UI."}
      </DialogDescription>
    </DialogHeader>
  );
}

function SoulFileEditorBody({
  busy,
  dialogError,
  dialogLoading,
  editContent,
  isDirty,
  isWritable,
  onEditContentChange,
  openFile,
  openFileMeta,
  status,
}: {
  busy: boolean;
  dialogError: string | null;
  dialogLoading: boolean;
  editContent: string;
  isDirty: boolean;
  isWritable: boolean;
  onEditContentChange: (value: string) => void;
  openFile: keyof SoulStackFiles | null;
  openFileMeta: SoulFileMeta;
  status: { files: SoulFileStatus } | null;
}) {
  const showMissingHint = Boolean(
    openFile && status && !status.files[openFile] && !editContent
  );

  if (dialogLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        {dialogError ? (
          <p className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            {dialogError}
          </p>
        ) : null}
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Loading file content…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {dialogError ? (
        <p className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {dialogError}
        </p>
      ) : null}

      {showMissingHint ? (
        <p className="shrink-0 text-muted-foreground text-sm leading-relaxed">
          This file is missing. Start writing — it will be created when you
          save.
        </p>
      ) : null}

      <Textarea
        className="field-sizing-fixed min-h-[min(52dvh,22rem)] flex-1 resize-none overflow-y-auto font-mono text-xs leading-relaxed sm:min-h-[min(58dvh,26rem)]"
        disabled={busy || dialogLoading}
        onChange={(event) => onEditContentChange(event.target.value)}
        placeholder={
          isWritable
            ? `Write ${openFileMeta?.label ?? "file"} content…`
            : "Examples are loaded from markdown files under examples/."
        }
        readOnly={!isWritable || dialogLoading}
        value={editContent}
      />

      {isWritable && isDirty ? (
        <p className="shrink-0 font-medium text-amber-700 text-xs dark:text-amber-300">
          Unsaved changes
        </p>
      ) : null}
    </div>
  );
}

function SoulFileEditorFooter({
  busy,
  dialogLoading,
  isDirty,
  isWritable,
  onOpenChange,
  onSave,
}: {
  busy: boolean;
  dialogLoading: boolean;
  isDirty: boolean;
  isWritable: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}) {
  return (
    <DialogFooter className="mx-0 mb-0 shrink-0 flex-col-reverse gap-3 border-border border-t bg-transparent p-0 pt-4 sm:flex-row sm:justify-end sm:pt-5">
      <Button
        className="w-full sm:w-auto"
        onClick={() => onOpenChange(false)}
        type="button"
        variant="outline"
      >
        Close
      </Button>
      {isWritable ? (
        <Button
          className="w-full sm:w-auto"
          disabled={busy || dialogLoading || !isDirty}
          onClick={onSave}
          type="button"
        >
          {busy ? <Spinner className="size-4" /> : "Save file"}
        </Button>
      ) : null}
    </DialogFooter>
  );
}

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
  openFileMeta: SoulFileMeta;
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] min-h-[min(82dvh,38rem)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        <SoulFileEditorHeader
          isWritable={isWritable}
          openFileMeta={openFileMeta}
        />
        <SoulFileEditorBody
          busy={busy}
          dialogError={dialogError}
          dialogLoading={dialogLoading}
          editContent={editContent}
          isDirty={isDirty}
          isWritable={isWritable}
          onEditContentChange={onEditContentChange}
          openFile={openFile}
          openFileMeta={openFileMeta}
          status={status}
        />
        <SoulFileEditorFooter
          busy={busy}
          dialogLoading={dialogLoading}
          isDirty={isDirty}
          isWritable={isWritable}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}
