import { PencilIcon } from "lucide-react";
import { useState } from "react";

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
import { cn } from "@/lib/utils";

type ExpandableTextareaProps = {
  label: string;
  htmlFor: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSave?: () => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
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
          <span className="text-xs text-muted-foreground">{label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="relative h-7 gap-1.5 py-0 pr-2 pl-1.5 text-xs text-muted-foreground after:absolute after:-inset-x-2 after:-inset-y-1"
            aria-controls={htmlFor}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <PencilIcon className="size-3.5" aria-hidden />
            Edit
          </Button>
        </div>
        <button
          type="button"
          id={htmlFor}
          disabled={disabled}
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={() => setOpen(true)}
          className={cn(
            "w-full rounded-lg border border-input px-2.5 py-2 text-left text-xs leading-relaxed outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out",
            "hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset",
            "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
            trimmed ? "font-mono text-foreground" : "text-muted-foreground",
            previewClassName,
          )}
        >
          <span className="line-clamp-2 whitespace-pre-wrap break-words text-pretty">{preview}</span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(92dvh,40rem)] flex-col gap-4 p-6 sm:max-w-3xl">
          <DialogHeader className="gap-2">
            <DialogTitle>{dialogTitle ?? label}</DialogTitle>
            {dialogDescription ? (
              <DialogDescription>{dialogDescription}</DialogDescription>
            ) : null}
          </DialogHeader>
          <Textarea
            id={`${htmlFor}-editor`}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            autoFocus
            className={cn(
              "min-h-[min(60dvh,28rem)] flex-1 font-mono text-sm leading-relaxed",
              className,
            )}
            onChange={onChange}
          />
          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
            <Button type="button" disabled={disabled || saving} onClick={() => void handleSave()}>
              {saving ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { ExpandableTextarea };
