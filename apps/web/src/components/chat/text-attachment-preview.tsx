import { Cancel01Icon } from "hugeicons-react";
import { wordCountFromPastedFilename } from "@/lib/pasted-text";
import { cn } from "@/lib/utils";

interface TextAttachmentPreviewProps {
  className?: string;
  filename: string;
  onRemove?: () => void;
  wordCount?: number;
}

export function TextAttachmentPreview({
  filename,
  wordCount,
  onRemove,
  className,
}: TextAttachmentPreviewProps) {
  const resolvedWordCount =
    wordCount ?? wordCountFromPastedFilename(filename) ?? undefined;

  return (
    <div
      className={cn(
        "relative inline-flex max-w-full shrink-0 items-center rounded-lg border border-border bg-muted px-3 py-2",
        onRemove ? "pr-8" : undefined,
        className
      )}
    >
      <div className="min-w-0">
        <p className="font-medium text-foreground text-xs">Pasted text</p>
        {resolvedWordCount == null ? null : (
          <p className="text-[10px] text-muted-foreground">
            {resolvedWordCount} words
          </p>
        )}
      </div>
      {onRemove ? (
        <button
          aria-label={`Remove ${filename}`}
          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-transparent text-muted-foreground transition-colors hover:text-foreground"
          onClick={onRemove}
          type="button"
        >
          <Cancel01Icon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
