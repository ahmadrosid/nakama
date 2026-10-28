import { cn } from "@nakama/ui/utils";
import { File01Icon } from "hugeicons-react";
import { useEffect, useId, useState } from "react";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  artifactCodeLanguage,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import type { DisplayDocument } from "@/lib/pasted-text";

interface DocumentAttachmentPreviewProps {
  className?: string;
  document: DisplayDocument;
}

/** A freshly sent `document` part carries its bytes as a `data:` URL; decode
 * them locally instead of fetching, since the app CSP does not allow `data:`
 * requests. */
function blobFromDataUrl(dataUrl: string, mediaType: string): Blob {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mediaType });
}

function downloadUrlFor(file: DisplayDocument): string | undefined {
  if (file.attachmentId) {
    return `/v1/attachments/${encodeURIComponent(file.attachmentId)}/content`;
  }

  return file.url;
}

function useDocumentAttachmentContent(file: DisplayDocument) {
  const resolvedMimeType = resolveArtifactMimeType(
    file.mediaType,
    file.filename
  );

  const isPdf = resolvedMimeType === "application/pdf";
  const isText = isTextArtifactMimeType(resolvedMimeType);
  const canPreview = isPdf || isText;

  const [blob, setBlob] = useState<Blob | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(canPreview);

  useEffect(() => {
    if (!canPreview) {
      setLoading(false);

      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadBlob = file.attachmentId
      ? client.readAttachmentContent(file.attachmentId)
      : Promise.resolve(
          file.url ? blobFromDataUrl(file.url, resolvedMimeType) : null
        );

    loadBlob
      .then((loaded): Promise<{ content: string | null; loaded: Blob }> => {
        if (!loaded) {
          throw new Error("Could not load this file.");
        }

        return isText
          ? loaded.text().then((content) => ({ content, loaded }))
          : Promise.resolve({ content: null, loaded });
      })
      .then(({ content, loaded }) => {
        if (!cancelled) {
          setBlob(loaded);
          setText(content);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(formatError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canPreview, file.attachmentId, file.url, isText, resolvedMimeType]);

  useEffect(() => {
    if (!blob) {
      return;
    }

    const url = URL.createObjectURL(blob);
    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return { canPreview, error, isPdf, isText, loading, objectUrl, text };
}

function DocumentUnavailablePreview({ file }: { file: DisplayDocument }) {
  const href = downloadUrlFor(file);

  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <File01Icon aria-hidden className="size-8 text-muted-foreground" />
      <p className="text-muted-foreground text-sm">
        Preview is not available for this file type.
      </p>
      {href ? (
        <a
          className="text-primary text-sm underline underline-offset-2"
          download={file.filename}
          href={href}
        >
          Download {file.filename}
        </a>
      ) : null}
    </div>
  );
}

function DocumentAttachmentPanelContent({ file }: { file: DisplayDocument }) {
  const { canPreview, error, isPdf, loading, objectUrl, text } =
    useDocumentAttachmentContent(file);

  if (!canPreview) {
    return <DocumentUnavailablePreview file={file} />;
  }

  const artifact = {
    filename: file.filename,
    mimeType: file.mediaType,
    path: file.filename,
    savedAt: "",
    sizeBytes: 0,
  };

  if (isPdf) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        error={error}
        kind="pdf"
        loading={loading}
        pdfPreviewUrl={objectUrl}
      />
    );
  }

  const isMarkdown = isMarkdownArtifactMimeType(file.mediaType);

  return (
    <ArtifactAttachmentPanelBody
      artifact={artifact}
      canPreview={canPreview}
      content={text}
      error={error}
      format={isMarkdown ? "markdown" : "plain"}
      kind="text"
      language={isMarkdown ? null : artifactCodeLanguage(file.filename)}
      loading={loading}
    />
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
  const interactive = Boolean(show);

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
      content: <DocumentAttachmentPanelContent file={file} />,
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
