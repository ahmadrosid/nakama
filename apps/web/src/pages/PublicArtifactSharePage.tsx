import { Download04Icon } from "hugeicons-react";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import { usePublicArtifactShare } from "@/hooks/use-public-artifact-share";
import { ARTIFACT_HTML_IFRAME_SANDBOX } from "@/lib/artifact-html-preview";
import {
  artifactCodeLanguage,
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
import { cn } from "@/lib/utils";

export function PublicArtifactSharePage() {
  const { token = "" } = useParams();
  const { data, isLoading, error: loadError } = usePublicArtifactShare(token);
  const metadata = data?.metadata ?? null;
  const content = data?.content ?? null;
  const error = token
    ? loadError instanceof Error
      ? loadError.message
      : loadError
        ? "Unable to load share."
        : null
    : "Share link not found.";
  const loading = token.length > 0 && isLoading;

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
  const language = metadata ? artifactCodeLanguage(metadata.filename) : null;
  const canPreview =
    metadata != null &&
    (isHtml ||
      isImage ||
      isVideo ||
      isWordDocument ||
      isTextArtifactMimeType(mimeType) ||
      isUnknownArtifactMimeType(mimeType));

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

  const downloadUrl = `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}`;

  return (
    <div
      className={cn(
        "artifact-share-page bg-background text-foreground",
        isHtml ? "flex h-svh flex-col overflow-hidden" : "h-svh overflow-y-auto"
      )}
    >
      <header className="border-border border-b px-3 py-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-medium text-xs">
            {metadata?.filename ?? "Shared artifact"}
          </p>
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

      <main
        className={cn(
          isHtml
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "mx-auto max-w-5xl px-4 py-6"
        )}
      >
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : artifact && canPreview ? (
          isImage ? (
            <ArtifactAttachmentPanelBody
              artifact={artifact}
              canPreview={canPreview}
              error={null}
              imagePreviewUrl={downloadUrl}
              kind="image"
              loading={false}
            />
          ) : isVideo ? (
            <ArtifactAttachmentPanelBody
              artifact={artifact}
              canPreview={canPreview}
              error={null}
              kind="video"
              loading={false}
              videoPreviewUrl={downloadUrl}
            />
          ) : isHtml ? (
            <ArtifactAttachmentPanelBody
              artifact={artifact}
              canPreview={canPreview}
              content={content}
              error={null}
              htmlSandbox={ARTIFACT_HTML_IFRAME_SANDBOX}
              kind="html"
              loading={false}
            />
          ) : (
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
          )
        ) : (
          <div className="space-y-3 text-muted-foreground text-sm">
            <p>This file is available for download.</p>
            {downloadUrl ? (
              <a
                className="font-medium text-foreground underline"
                href={downloadUrl}
              >
                Download {metadata?.filename}
              </a>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
