import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import { usePublicArtifactShare } from "@/hooks/use-public-artifact-share";
import {
  artifactCodeLanguage,
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { ARTIFACT_HTML_IFRAME_SANDBOX } from "@/lib/artifact-html-preview";
import { cn } from "@/lib/utils";

export function PublicArtifactSharePage() {
  const { token = "" } = useParams();
  const { data, isLoading, error: loadError } = usePublicArtifactShare(token);
  const metadata = data?.metadata ?? null;
  const content = data?.content ?? null;
  const error = !token
    ? "Share link not found."
    : loadError instanceof Error
      ? loadError.message
      : loadError
        ? "Unable to load share."
        : null;
  const loading = token.length > 0 && isLoading;

  const mimeType = metadata ? resolveArtifactMimeType(metadata.mimeType, metadata.filename) : "";
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isWordDocument =
    metadata != null &&
    (isDocxFile(metadata.filename, mimeType) || isLegacyDocFile(metadata.filename, mimeType));
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = metadata ? artifactCodeLanguage(metadata.filename) : null;
  const canPreview =
    metadata != null &&
    (isHtml ||
      isWordDocument ||
      isTextArtifactMimeType(mimeType) ||
      isUnknownArtifactMimeType(mimeType));

  const artifact = useMemo(
    () =>
      metadata
        ? {
            filename: metadata.filename,
            path: metadata.filename,
            mimeType: metadata.mimeType,
            sizeBytes: metadata.sizeBytes,
            savedAt: "",
          }
        : null,
    [metadata],
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
        "bg-background text-foreground",
        isHtml ? "flex h-svh flex-col overflow-hidden" : "min-h-svh",
      )}
    >
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {metadata?.filename ?? "Shared artifact"}
            </p>
            <p className="text-xs text-muted-foreground">Nakama shared artifact</p>
          </div>
          {token ? (
            <a
              href={downloadUrl}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Download
            </a>
          ) : null}
        </div>
      </header>

      <main
        className={cn(
          isHtml
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "mx-auto max-w-5xl px-4 py-6",
        )}
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : artifact && canPreview ? (
          isHtml ? (
            <ArtifactAttachmentPanelBody
              kind="html"
              loading={false}
              error={null}
              content={content}
              canPreview={canPreview}
              artifact={artifact}
              htmlSandbox={ARTIFACT_HTML_IFRAME_SANDBOX}
            />
          ) : (
            <ArtifactAttachmentPanelBody
              kind="text"
              format={isMarkdown ? "markdown" : "plain"}
              language={language}
              loading={false}
              error={null}
              content={content}
              canPreview={canPreview}
              artifact={artifact}
            />
          )
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>This file is available for download.</p>
            {downloadUrl ? (
              <a href={downloadUrl} className="font-medium text-foreground underline">
                Download {metadata?.filename}
              </a>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
