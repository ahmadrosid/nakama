import { Button } from "@nakama/ui/button";
import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  Download04Icon,
} from "hugeicons-react";
import { useEffect, useId, useMemo, useState } from "react";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import { CompactFileCard } from "@/components/chat/artifact-attachment-preview";
import { WorkbookGrid } from "@/components/chat/artifact-workbook-preview";
import { useAuth } from "@/context/use-auth";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { ARTIFACT_HTML_IFRAME_SANDBOX } from "@/lib/artifact-html-preview";
import {
  parseXlsxPreview,
  type WorkbookPreview,
} from "@/lib/artifact-office-preview";
import { isXlsxFile } from "@/lib/artifact-spreadsheet";
import {
  artifactCodeLanguage,
  FILE_PREVIEW_MAX_BYTES,
  isDelimitedSpreadsheetFile,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isVideoArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import { createClientId } from "@/lib/client-id";
import type { DisplayDocument } from "@/lib/pasted-text";

function downloadFile(file: DisplayDocument) {
  const href = file.attachmentId
    ? `${client.baseUrl}/v1/attachments/${encodeURIComponent(file.attachmentId)}/content`
    : file.url;

  if (!href) {
    return;
  }

  if (!(file.attachmentId || /^data:[^,]*;base64,/i.test(href))) {
    return;
  }

  const link = document.createElement("a");
  link.href = href;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Check inline bytes before allocating a decoded buffer. */
function inlineBlob(file: DisplayDocument): Blob {
  const match = /^data:([^,]*);base64,([\s\S]*)$/i.exec(file.url ?? "");

  if (!match) {
    throw new Error("This attachment has no readable file content.");
  }

  const base64 = match[2].replace(/\s/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;

  if (Math.floor((base64.length * 3) / 4) - padding > FILE_PREVIEW_MAX_BYTES) {
    throw new Error(
      "This file exceeds the 8 MB preview limit. Download it instead."
    );
  }

  const binary = atob(base64);

  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], {
    type: file.mediaType,
  });
}

/** Which preview an uploaded file gets. */
function documentPreviewKind(file: DisplayDocument) {
  const mime = resolveArtifactMimeType(file.mediaType, file.filename);
  const isWorkbook = isXlsxFile(file.filename, mime);

  const isWord =
    isDocxFile(file.filename, mime) || isLegacyDocFile(file.filename, mime);

  const isImage = isImageArtifactMimeType(mime);
  const isVideo = isVideoArtifactMimeType(mime);
  const isPdf = mime === "application/pdf";
  const isHtml = isHtmlArtifactMimeType(mime);
  const isSheet = isDelimitedSpreadsheetFile(file.filename, mime);
  const isText = isTextArtifactMimeType(mime) || isWord || isSheet;

  const canPreview = [
    isWorkbook,
    isImage,
    isVideo,
    isPdf,
    isHtml,
    isText,
  ].includes(true);

  return {
    canPreview,
    isHtml,
    isImage,
    isPdf,
    isSheet,
    isText,
    isVideo,
    isWord,
    isWorkbook,
    mime,
  };
}

function DocumentAttachmentPanelContent({ file }: { file: DisplayDocument }) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id;

  const [loaded, setLoaded] = useState<{
    blob: Blob;
    text: string | null;
    workbook: WorkbookPreview | null;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const {
    canPreview,
    isHtml,
    isImage,
    isPdf,
    isSheet,
    isText,
    isVideo,
    isWord,
    isWorkbook,
    mime,
  } = documentPreviewKind(file);

  useEffect(() => {
    if (!canPreview) {
      return;
    }

    const controller = new AbortController();
    setLoaded(null);
    setError(null);
    const scoped = client.forOrg(orgId ?? null);

    const load = file.attachmentId
      ? scoped.readAttachmentContent(file.attachmentId, {
          maxBytes: FILE_PREVIEW_MAX_BYTES,
          render: isWord ? "markdown" : undefined,
          signal: controller.signal,
        })
      : Promise.resolve().then(() => inlineBlob(file));

    void load
      .then(async (blob) => {
        if (blob.size > FILE_PREVIEW_MAX_BYTES) {
          throw new Error(
            "This file exceeds the 8 MB preview limit. Download it instead."
          );
        }

        if (isWord && !file.attachmentId) {
          throw new Error(
            "Download this inline Word file, or send it to preview it."
          );
        }

        const data = isWorkbook ? await blob.arrayBuffer() : null;

        const workbook =
          isWorkbook && data ? await parseXlsxPreview(data) : null;

        const text = isText || isHtml ? await blob.text() : null;

        if (!controller.signal.aborted) {
          setLoaded({ blob, text, workbook });
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(formatError(reason));
        }
      });

    return () => controller.abort();
  }, [
    canPreview,
    file.attachmentId,
    file.url,
    file.filename,
    file.mediaType,
    isWorkbook,
    isWord,
    isText,
    isHtml,
    orgId,
  ]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    const next = URL.createObjectURL(loaded.blob);
    setUrl(next);

    return () => URL.revokeObjectURL(next);
  }, [loaded]);

  const artifact = {
    filename: file.filename,
    mimeType: mime,
    path: file.filename,
    savedAt: "",
    sizeBytes: 0,
  };

  const common = {
    artifact,
    canPreview,
    error,
    loading: canPreview && !loaded && !error,
  };

  if (error) {
    return (
      <p className="p-4 text-destructive text-sm" role="alert">
        {error}
      </p>
    );
  }

  if (loaded?.workbook) {
    return <WorkbookGrid workbook={loaded.workbook} />;
  }

  if (isPdf) {
    return (
      <ArtifactAttachmentPanelBody {...common} kind="pdf" pdfPreviewUrl={url} />
    );
  }

  if (isImage) {
    return (
      <ArtifactAttachmentPanelBody
        {...common}
        imagePreviewUrl={url}
        kind="image"
      />
    );
  }

  if (isVideo) {
    return (
      <ArtifactAttachmentPanelBody
        {...common}
        kind="video"
        videoPreviewUrl={url}
      />
    );
  }

  if (isHtml) {
    return (
      <ArtifactAttachmentPanelBody
        {...common}
        content={loaded?.text ?? null}
        htmlSandbox={ARTIFACT_HTML_IFRAME_SANDBOX}
        kind="html"
      />
    );
  }

  if (isSheet) {
    return (
      <ArtifactAttachmentPanelBody
        {...common}
        content={loaded?.text ?? null}
        kind="spreadsheet"
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      {...common}
      content={loaded?.text ?? null}
      format={isWord || isMarkdownArtifactMimeType(mime) ? "markdown" : "plain"}
      kind="text"
      language={artifactCodeLanguage(file.filename)}
    />
  );
}

/**
 * Reads and sets fullscreen on the panel itself. The list unmounts cards that
 * leave the screen (fullscreen hides the whole list), so card state would go.
 */
function PanelFullscreenToggle({ panelId }: { panelId: string }) {
  const panel = useOptionalChatAttachmentPanel();
  const fullscreen = panel?.isFullscreen ?? false;

  return (
    <Button
      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() => panel?.update(panelId, { fullscreen: !fullscreen })}
      size="icon-sm"
      variant="ghost"
    >
      {fullscreen ? (
        <ArrowShrink02Icon className="size-4" />
      ) : (
        <ArrowExpand01Icon className="size-4" />
      )}
    </Button>
  );
}

/** Sent uploads use the same file cards and panel as saved artifacts. */
export function DocumentAttachmentPreview({
  document: file,
  className,
}: {
  document: DisplayDocument;
  className?: string;
}) {
  const panelId = useId();
  const panel = useOptionalChatAttachmentPanel();
  const { activeOrg } = useAuth();
  const open = panel?.activeId === panelId;
  const show = panel?.show;
  const update = panel?.update;
  const mime = resolveArtifactMimeType(file.mediaType, file.filename);

  const contentKey = useMemo(
    () => createClientId(),
    [activeOrg?.id, file.attachmentId, file.url, file.filename]
  );

  const config = () => ({
    bodyClassName: artifactPanelBodyClassName({
      isHtml: isHtmlArtifactMimeType(mime),
      isImage: isImageArtifactMimeType(mime),
      isMarkdown:
        isMarkdownArtifactMimeType(mime) ||
        isDocxFile(file.filename, mime) ||
        isLegacyDocFile(file.filename, mime),
      isSpreadsheet:
        isXlsxFile(file.filename, mime) ||
        isDelimitedSpreadsheetFile(file.filename, mime),
      isVideo: isVideoArtifactMimeType(mime),
    }),
    content: <DocumentAttachmentPanelContent file={file} key={contentKey} />,
    headerActions: (
      <>
        <Button
          aria-label={`Download ${file.filename}`}
          onClick={() => downloadFile(file)}
          size="icon-sm"
          variant="ghost"
        >
          <Download04Icon className="size-4" />
        </Button>
        <PanelFullscreenToggle panelId={panelId} />
      </>
    ),
    title: file.filename,
  });

  useEffect(() => {
    if (open) {
      update?.(panelId, config());
    }
    // The panel functions are stable; file identity controls content remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, update, panelId, contentKey]);

  return (
    <CompactFileCard
      artifact={{
        filename: file.filename,
        mimeType: mime,
        path: file.filename,
        savedAt: "",
        sizeBytes: 0,
      }}
      className={className}
      isImage={isImageArtifactMimeType(mime)}
      isVideo={isVideoArtifactMimeType(mime)}
      onOpen={() => {
        show?.({
          ...config(),
          defaultWidth: artifactPanelDefaultWidth(file.filename, mime),
          fullscreen: false,
          id: panelId,
        });
      }}
    />
  );
}
