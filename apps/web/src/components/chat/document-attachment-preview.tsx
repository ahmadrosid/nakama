import { CodeBlock } from "@nakama/ui/code-block";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { File01Icon } from "hugeicons-react";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  artifactCodeLanguage,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import type { DisplayDocument } from "@/lib/pasted-text";

const MessageResponse = lazy(async () => ({
  default: (await import("@/components/ai-elements/message")).MessageResponse,
}));

interface DocumentAttachmentPreviewProps {
  className?: string;
  document: DisplayDocument;
}

function resolvePreviewUrl(file: DisplayDocument): string | undefined {
  if (file.url) {
    return file.url;
  }

  if (file.attachmentId) {
    return `/v1/attachments/${encodeURIComponent(file.attachmentId)}/content?inline=1`;
  }

  return undefined;
}

function DocumentTextPreview({
  filename,
  mediaType,
  url,
}: {
  filename: string;
  mediaType: string;
  url: string;
}) {
  const [state, setState] = useState<{
    content: string | null;
    error: string | null;
    loading: boolean;
  }>({ content: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ content: null, error: null, loading: true });

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load file content.");
        }

        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) {
          setState({
            content: new TextDecoder().decode(buffer),
            error: null,
            loading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            content: null,
            error: "Could not load this file.",
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        Loading preview…
      </div>
    );
  }

  if (state.error || state.content === null) {
    return (
      <p className="p-4 text-destructive text-sm">
        {state.error ?? "Could not load this file."}
      </p>
    );
  }

  if (isMarkdownArtifactMimeType(mediaType)) {
    return (
      <Suspense fallback={<Spinner className="size-6" />}>
        <MessageResponse className="p-4 text-sm">
          {state.content}
        </MessageResponse>
      </Suspense>
    );
  }

  return (
    <CodeBlock
      className="rounded-none border-0"
      code={state.content}
      lang={artifactCodeLanguage(filename)}
    />
  );
}

function DocumentAttachmentPanelContent({
  filename,
  mediaType,
  url,
}: {
  filename: string;
  mediaType: string;
  url: string;
}) {
  const resolvedMimeType = resolveArtifactMimeType(mediaType, filename);

  if (resolvedMimeType === "application/pdf") {
    return (
      <object
        aria-label={filename}
        className="min-h-[70vh] w-full flex-1 border-0"
        data={url}
        type="application/pdf"
      >
        <a download={filename} href={url}>
          Download PDF
        </a>
      </object>
    );
  }

  if (isTextArtifactMimeType(resolvedMimeType)) {
    return (
      <DocumentTextPreview
        filename={filename}
        mediaType={resolvedMimeType}
        url={url}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <File01Icon aria-hidden className="size-8 text-muted-foreground" />
      <p className="text-muted-foreground text-sm">
        Preview is not available for this file type.
      </p>
      <a
        className="text-primary text-sm underline underline-offset-2"
        download={filename}
        href={url}
      >
        Download {filename}
      </a>
    </div>
  );
}

export function DocumentAttachmentPreview({
  document: file,
  className,
}: DocumentAttachmentPreviewProps) {
  const panelId = useId();
  const attachmentPanel = useOptionalChatAttachmentPanel();
  const show = attachmentPanel?.show;
  const hide = attachmentPanel?.hide;
  const previewUrl = resolvePreviewUrl(file);
  const interactive = Boolean(show) && Boolean(previewUrl);

  useEffect(() => {
    if (!hide) {
      return;
    }

    return () => {
      hide(panelId);
    };
  }, [hide, panelId]);

  function openPanel() {
    if (!(show && previewUrl)) {
      return;
    }

    show({
      content: (
        <DocumentAttachmentPanelContent
          filename={file.filename}
          mediaType={file.mediaType}
          url={previewUrl}
        />
      ),
      id: panelId,
      title: file.filename,
    });
  }

  const chip = (
    <>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <File01Icon aria-hidden className="size-4 text-muted-foreground" />
      </div>
      <span className="truncate text-foreground text-sm">{file.filename}</span>
    </>
  );

  if (interactive) {
    return (
      <button
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-left transition-colors hover:bg-muted/70",
          className
        )}
        onClick={openPanel}
        type="button"
      >
        {chip}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2",
        className
      )}
    >
      {chip}
    </div>
  );
}
