import type { SoulFileStatus, SoulStackFiles } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSheetContent,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { EditorStatus, EditorTextarea } from "@nakama/ui/textarea";
import { File01Icon, Folder01Icon } from "hugeicons-react";

function SoulFileEditorHeader({
  openFileMeta,
  isWritable,
}: {
  openFileMeta:
    | {
        label: string;
        description: string;
        writable: boolean;
      }
    | null
    | undefined;
  isWritable: boolean;
}) {
  return (
    <DialogHeader className="h-12 shrink-0 flex-row items-center gap-2.5 border-border border-b pr-14 pl-5">
      <DialogTitle className="flex shrink-0 items-center gap-2 font-mono text-sm">
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
      <DialogDescription className="min-w-0 truncate text-xs">
        {openFileMeta?.description}
        {isWritable ? null : " Read-only in the UI."}
      </DialogDescription>
    </DialogHeader>
  );
}

function SoulFileEditorBody({
  dialogError,
  dialogLoading,
  openFile,
  status,
  editContent,
  busy,
  isWritable,
  isDirty,
  openFileMeta,
  onEditContentChange,
  onSave,
}: {
  dialogError: string | null;
  dialogLoading: boolean;
  openFile: keyof SoulStackFiles | null;
  status: { files: SoulFileStatus } | null;
  editContent: string;
  busy: boolean;
  isWritable: boolean;
  isDirty: boolean;
  openFileMeta:
    | {
        label: string;
      }
    | null
    | undefined;
  onEditContentChange: (value: string) => void;
  onSave: () => void;
}) {
  const showMissingHint = Boolean(
    isWritable && openFile && status && !status.files[openFile] && !editContent
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dialogError ? (
        <p className="shrink-0 border-destructive/30 border-b bg-destructive/10 px-6 py-3 text-destructive text-sm">
          {dialogError}
        </p>
      ) : null}

      {showMissingHint && !dialogLoading ? (
        <p className="shrink-0 border-border border-b bg-muted/40 px-6 py-3 text-muted-foreground text-sm">
          This file is missing. Start writing — it will be created when you
          save.
        </p>
      ) : null}

      {dialogLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Loading file content…
        </div>
      ) : (
        <EditorTextarea
          aria-label={openFileMeta?.label ?? "File content"}
          autoFocus={isWritable}
          disabled={busy}
          onChange={(event) => onEditContentChange(event.target.value)}
          onSave={() => {
            if (isWritable && isDirty && !busy) {
              onSave();
            }
          }}
          placeholder={
            isWritable
              ? `Write ${openFileMeta?.label ?? "file"} content…`
              : "File content is read-only."
          }
          readOnly={!isWritable}
          value={editContent}
        />
      )}
    </div>
  );
}

function SoulFileEditorFooter({
  editContent,
  isWritable,
  busy,
  dialogLoading,
  isDirty,
  onSave,
}: {
  editContent: string;
  isWritable: boolean;
  busy: boolean;
  dialogLoading: boolean;
  isDirty: boolean;
  onSave: () => void;
}) {
  return (
    <DialogFooter className="m-0 shrink-0 items-center gap-2 rounded-none border-border border-t bg-transparent px-5 py-2.5 sm:flex-row sm:justify-between">
      <div className="flex items-center gap-3">
        <EditorStatus value={editContent} />
        {isWritable && isDirty ? (
          <span className="flex items-center gap-1.5 font-medium text-amber-700 text-xs dark:text-amber-300">
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            Unsaved
          </span>
        ) : null}
      </div>
      {isWritable ? (
        <Button
          disabled={busy || dialogLoading || !isDirty}
          onClick={onSave}
          title="Save (⌘S)"
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
  openFileMeta:
    | {
        label: string;
        description: string;
        writable: boolean;
      }
    | null
    | undefined;
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
      <DialogSheetContent>
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
          onSave={onSave}
          openFile={openFile}
          openFileMeta={openFileMeta}
          status={status}
        />
        <SoulFileEditorFooter
          busy={busy}
          dialogLoading={dialogLoading}
          editContent={editContent}
          isDirty={isDirty}
          isWritable={isWritable}
          onSave={onSave}
        />
      </DialogSheetContent>
    </Dialog>
  );
}
