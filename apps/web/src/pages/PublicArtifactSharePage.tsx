import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactCodeLanguage,
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { cn } from "@/lib/utils";

interface PublicShareMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  inlineAllowed: boolean;
}

export function PublicArtifactSharePage() {
  const { token = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<PublicShareMetadata | null>(null);
  const [content, setContent] = useState<string | null>(null);

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

  useEffect(() => {
    if (!token) {
      setError("Share link not found.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadShare() {
      setLoading(true);
      setError(null);

      try {
        const metaResponse = await fetch(
          `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}?meta=1`,
        );

        if (!metaResponse.ok) {
          throw new Error("This share link is unavailable.");
        }

        const meta = (await metaResponse.json()) as PublicShareMetadata;
        if (cancelled) {
          return;
        }

        setMetadata(meta);

        const resolvedMime = resolveArtifactMimeType(meta.mimeType, meta.filename);
        const previewAsHtml = isHtmlArtifactMimeType(resolvedMime);

        // HTML is blocked from inline API serving (same-origin XSS) but still previewed
        // here via a sandboxed iframe srcDoc on the web app origin.
        if (!meta.inlineAllowed && !previewAsHtml) {
          setContent(null);
          setLoading(false);
          return;
        }

        const contentResponse = await fetch(
          `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}`,
        );

        if (!contentResponse.ok) {
          throw new Error("This share link is unavailable.");
        }

        const bytes = new Uint8Array(await contentResponse.arrayBuffer());
        const contentType = resolveArtifactMimeType(
          contentResponse.headers.get("Content-Type") ?? meta.mimeType,
          meta.filename,
        );

        if (isHtmlArtifactMimeType(contentType)) {
          setContent(new TextDecoder().decode(bytes));
        } else if (looksLikeUtf8Text(bytes)) {
          setContent(new TextDecoder().decode(bytes));
        } else {
          setContent(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load share.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadShare();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const downloadUrl = `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}`;

  return (
    <div className="min-h-svh bg-background text-foreground">
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
          "mx-auto max-w-5xl px-4 py-6",
          isHtml && "flex h-[calc(100svh-4rem)] flex-col",
        )}
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : artifact && canPreview ? (
          <ArtifactAttachmentPanelBody
            isHtml={isHtml}
            isMarkdown={isMarkdown}
            language={language}
            loading={false}
            error={null}
            content={content}
            canPreview={canPreview}
            artifact={artifact}
            htmlSandbox="allow-same-origin"
          />
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
