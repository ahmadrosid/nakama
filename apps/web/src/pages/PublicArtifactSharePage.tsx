import { Download04Icon } from "hugeicons-react";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import { usePublicArtifactShare } from "@/hooks/use-public-artifact-share";
import { ARTIFACT_HTML_IFRAME_SANDBOX } from "@/lib/artifact-html-preview";
import {
  artifactCodeLanguage,
  isDelimitedSpreadsheetFile,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  isVideoArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { buildPublicArtifactShareUrl } from "@/lib/public-artifact-share-url";
import { cn } from "@/lib/utils";

function publicShareError(token: string, loadError: unknown): string | null {
  if (!token) {
    return "Share link not found.";
  }

  if (loadError instanceof Error) {
    return loadError.message;
  }

  if (loadError) {
    return "Unable to load share.";
  }

  return null;
}

function deriveSharePreview(
  metadata: {
    filename: string;
    mimeType: string;
  } | null
) {
  const mimeType = metadata
    ? resolveArtifactMimeType(metadata.mimeType, metadata.filename)
    : "";
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isVideo = isVideoArtifactMimeType(mimeType);
  const isWordDocument =
    metadata != null &&
    (isDocxFile(metadata.filename, mimeType) ||
      isLegacyDocFile(metadata.filename, mimeType));
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const isSpreadsheet =
    metadata != null && isDelimitedSpreadsheetFile(metadata.filename, mimeType);
  const canPreview =
    metadata != null &&
    (isHtml ||
      isImage ||
      isVideo ||
      isWordDocument ||
      isTextArtifactMimeType(mimeType) ||
      isUnknownArtifactMimeType(mimeType));

  return {
    canPreview,
    isHtml,
    isImage,
    isMarkdown,
    isSpreadsheet,
    isVideo,
    language: metadata ? artifactCodeLanguage(metadata.filename) : null,
    mimeType,
  };
}

function PublicArtifactShareHeader({
  filename,
  token,
  downloadUrl,
}: {
  filename: string;
  token: string;
  downloadUrl: string;
}) {
  return (
    <header className="border-border border-b px-3 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-medium text-xs">{filename}</p>
        {token ? (
          <a
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-xs hover:bg-muted"
            href={downloadUrl}
          >
            <Download04Icon className="h-3 w-3" />
            Download
          </a>
        ) : null}
      </div>
    </header>
  );
}

type SharePreview = ReturnType<typeof deriveSharePreview>;

function PublicArtifactPreview({
  artifact,
  content,
  downloadUrl,
  preview,
}: {
  artifact: {
    filename: string;
    mimeType: string;
    path: string;
    savedAt: string;
    sizeBytes: number;
  };
  content: string | null;
  downloadUrl: string;
  preview: SharePreview;
}) {
  const {
    canPreview,
    isHtml,
    isImage,
    isMarkdown,
    isSpreadsheet,
    isVideo,
    language,
  } = preview;
  if (isImage) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        error={null}
        imagePreviewUrl={downloadUrl}
        kind="image"
        loading={false}
      />
    );
  }

  if (isVideo) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        error={null}
        kind="video"
        loading={false}
        videoPreviewUrl={downloadUrl}
      />
    );
  }

  if (isHtml) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        content={content}
        error={null}
        htmlSandbox={ARTIFACT_HTML_IFRAME_SANDBOX}
        kind="html"
        loading={false}
      />
    );
  }

  if (isSpreadsheet) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        content={content}
        error={null}
        kind="spreadsheet"
        loading={false}
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      artifact={artifact}
      canPreview={canPreview}
      content={content}
      error={null}
      format={isMarkdown ? "markdown" : "plain"}
      kind="text"
      language={language}
      loading={false}
    />
  );
}

function PublicArtifactShareMain({
  artifact,
  content,
  downloadUrl,
  error,
  filename,
  loading,
  preview,
}: {
  artifact: {
    filename: string;
    mimeType: string;
    path: string;
    savedAt: string;
    sizeBytes: number;
  } | null;
  content: string | null;
  downloadUrl: string;
  error: string | null;
  filename?: string;
  loading: boolean;
  preview: SharePreview;
}) {
  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  if (artifact && preview.canPreview) {
    return (
      <PublicArtifactPreview
        artifact={artifact}
        content={content}
        downloadUrl={downloadUrl}
        preview={preview}
      />
    );
  }

  return (
    <div className="space-y-3 text-muted-foreground text-sm">
      <p>This file is available for download.</p>
      {downloadUrl ? (
        <a className="font-medium text-foreground underline" href={downloadUrl}>
          Download {filename}
        </a>
      ) : null}
    </div>
  );
}

export function PublicArtifactSharePage() {
  const { token = "" } = useParams();
  const { data, isLoading, error: loadError } = usePublicArtifactShare(token);
  const metadata = data?.metadata ?? null;
  const content = data?.content ?? null;
  const error = publicShareError(token, loadError);
  const loading = token.length > 0 && isLoading;
  const preview = deriveSharePreview(metadata);

  const artifact = useMemo(
    () =>
      metadata
        ? {
            filename: metadata.filename,
            mimeType: metadata.mimeType,
            path: metadata.filename,
            savedAt: "",
            sizeBytes: metadata.sizeBytes,
          }
        : null,
    [metadata]
  );

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.append(meta);
    return () => {
      meta.remove();
    };
  }, []);

  const downloadUrl = buildPublicArtifactShareUrl(client.baseUrl, token);
  const fillViewport = preview.isHtml || preview.isSpreadsheet;

  return (
    <div
      className={cn(
        "artifact-share-page bg-background text-foreground",
        fillViewport
          ? "flex h-svh flex-col overflow-hidden"
          : "h-svh overflow-y-auto"
      )}
    >
      <PublicArtifactShareHeader
        downloadUrl={downloadUrl}
        filename={metadata?.filename ?? "Shared artifact"}
        token={token}
      />

      <main
        className={cn(
          fillViewport
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "mx-auto max-w-5xl px-4 py-6"
        )}
      >
        <PublicArtifactShareMain
          artifact={artifact}
          content={content}
          downloadUrl={downloadUrl}
          error={error}
          filename={metadata?.filename}
          loading={loading}
          preview={preview}
        />
      </main>
    </div>
  );
}
