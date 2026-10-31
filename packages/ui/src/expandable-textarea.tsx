import { Edit03Icon } from "hugeicons-react";
import { useState } from "react";

import { Button } from "./button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSheetContent,
  DialogTitle,
} from "./dialog";
import { Spinner } from "./spinner";
import { EditorStatus, EditorTextarea } from "./textarea";
import { cn } from "./utils";

type ExpandableTextareaProps = {
  label: string;
  htmlFor: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSave?: () => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
  labelClassName?: string;
  editButtonClassName?: string;
  previewClassName?: string;
  dialogTitle?: string;
  dialogDescription?: string;
  placeholder?: string;
  emptyLabel?: string;
};

function ExpandableTextarea({
  label,
  htmlFor,
  value,
  onChange,
  onSave,
  disabled = false,
  className,
  containerClassName,
  labelClassName,
  editButtonClassName,
  previewClassName,
  dialogTitle,
  dialogDescription,
  placeholder,
  emptyLabel = "Click to edit…",
}: ExpandableTextareaProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const trimmed = value.trim();
  const preview = trimmed || placeholder || emptyLabel;

  async function handleSave() {
    if (disabled || saving) {
      return;
    }

    if (onSave) {
      setSaving(true);

      try {
        const result = await onSave();

        if (result === false) {
          return;
        }
      } finally {
        setSaving(false);
      }
    }

    setOpen(false);
  }

  return (
    <>
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-muted-foreground text-xs", labelClassName)}>
            {label}
          </span>
          <Button
            aria-controls={htmlFor}
            aria-expanded={open}
            className={cn(
              "relative h-7 gap-1.5 py-0 pr-2 pl-1.5 text-muted-foreground text-xs after:absolute after:-inset-x-2 after:-inset-y-1",
              editButtonClassName
            )}
            disabled={disabled}
            onClick={() => setOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Edit03Icon aria-hidden className="size-3.5" />
            Edit
          </Button>
        </div>
        <button
          aria-label={`Edit ${label.toLowerCase()}`}
          className={cn(
            "w-full rounded-lg border border-input px-2.5 py-2 text-left text-xs leading-relaxed outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out",
            "hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset",
            "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
            trimmed ? "font-mono text-foreground" : "text-muted-foreground",
            previewClassName
          )}
          disabled={disabled}
          id={htmlFor}
          onClick={() => setOpen(true)}
          type="button"
        >
          <span className="line-clamp-2 whitespace-pre-wrap text-pretty break-words">
            {preview}
          </span>
        </button>
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogSheetContent>
          <DialogHeader className="h-12 shrink-0 flex-row items-center gap-2.5 border-border border-b pr-14 pl-5">
            <DialogTitle className="shrink-0 text-sm">
              {dialogTitle ?? label}
            </DialogTitle>
            {dialogDescription ? (
              <DialogDescription className="min-w-0 truncate text-xs">
                {dialogDescription}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <EditorTextarea
            aria-label={label}
            autoFocus
            className={className}
            disabled={disabled}
            id={`${htmlFor}-editor`}
            onChange={onChange}
            onSave={() => void handleSave()}
            placeholder={placeholder}
            value={value}
          />
          <DialogFooter className="m-0 shrink-0 items-center gap-2 rounded-none border-border border-t bg-transparent px-5 py-2.5 sm:flex-row sm:justify-between">
            <EditorStatus value={value} />
            <Button
              disabled={disabled || saving}
              onClick={() => void handleSave()}
              title="Save (⌘S)"
              type="button"
            >
              {saving ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogSheetContent>
      </Dialog>
    </>
  );
}

export { ExpandableTextarea };
