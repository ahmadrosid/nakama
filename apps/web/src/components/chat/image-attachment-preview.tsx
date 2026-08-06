import { ImageIcon, XIcon } from "lucide-react";
import { useEffect, useId } from "react";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { cn } from "@/lib/utils";

interface ImageAttachmentPreviewProps {
  url?: string;
  description?: string | null;
  caption?: string | null;
  onRemove?: () => void;
  className?: string;
}

function previewText(description?: string | null): string | null {
  const described = description?.trim();
  return described || null;
}

export function ImageAttachmentPreview({
  url,
  description,
  caption,
  onRemove,
  className,
}: ImageAttachmentPreviewProps) {
  const panelId = useId();
  const attachmentPanel = useOptionalChatAttachmentPanel();
  const show = attachmentPanel?.show;
  const hide = attachmentPanel?.hide;
  const interactive =
    !onRemove &&
    Boolean(attachmentPanel) &&
    Boolean(url || description?.trim());
  const chipPreview = previewText(description);

  useEffect(() => {
    if (!hide) {
      return;
    }

    return () => {
      hide(panelId);
    };
  }, [hide, panelId]);

  function openPanel() {
    if (!show) {
      return;
    }

    show({
      id: panelId,
      title: "Image",
      content: (
        <div className="space-y-4">
          {url ? (
            <img
              src={url}
              alt=""
              className="max-h-[min(50vh,28rem)] w-full rounded-lg border border-border object-contain"
            />
          ) : null}
          {caption?.trim() ? (
            <section className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Message</h3>
              <p className="whitespace-pre-wrap text-sm text-foreground">{caption.trim()}</p>
            </section>
          ) : null}
          {description?.trim() ? (
            <section className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Description</h3>
              <p className="whitespace-pre-wrap text-sm text-foreground">{description.trim()}</p>
            </section>
          ) : null}
        </div>
      ),
    });
  }

  const chip = (
    <>
      {url ? (
        <img
          src={url}
          alt=""
          className="size-10 shrink-0 rounded-md border border-border object-cover"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
        </div>
      )}
      {chipPreview ? (
        <div className="min-w-0 max-w-[10rem]">
          <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{chipPreview}</p>
        </div>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={cn(
          "relative inline-flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-muted px-2 py-2 text-left transition-colors hover:bg-muted/70",
          className,
        )}
        onClick={openPanel}
      >
        {chip}
      </button>
    );
  }

  const removeButton = onRemove ? (
    <button
      type="button"
      className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
      aria-label="Remove image"
      onClick={onRemove}
    >
      <XIcon className="size-3" />
    </button>
  ) : null;

  if (onRemove && url && !chipPreview) {
    return (
      <div
        className={cn(
          "relative size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted",
          className,
        )}
      >
        <img src={url} alt="" className="size-full object-cover" />
        {removeButton}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative inline-flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-muted px-2 py-2",
        onRemove ? "pr-10" : undefined,
        className,
      )}
    >
      {chip}
      {removeButton}
    </div>
  );
}
