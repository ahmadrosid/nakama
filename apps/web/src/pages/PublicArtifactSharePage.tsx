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
import { cn } from "@/lib/utils";

type ShareMetadata = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type ShareArtifact = {
  filename: string;
  mimeType: string;
  path: string;
  savedAt: string;
  sizeBytes: number;
};

type SharePreviewKind =
  | "image"
  | "video"
  | "html"
  | "spreadsheet"
  | "markdown"
  | "text"
  | "download";

function resolveShareError(token: string, loadError: unknown): string | null {
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

function resolveSharePreviewKind(metadata: ShareMetadata | null): {
  kind: SharePreviewKind;
  language: string | null;
  fullBleed: boolean;
} {
  if (!metadata) {
    return { fullBleed: false, kind: "download", language: null };
  }

  const mimeType = resolveArtifactMimeType(
    metadata.mimeType,
    metadata.filename
  );
  const isWordDocument =
    isDocxFile(metadata.filename, mimeType) ||
    isLegacyDocFile(metadata.filename, mimeType);
  const isSpreadsheet = isDelimitedSpreadsheetFile(metadata.filename, mimeType);
  const language = artifactCodeLanguage(metadata.filename);

  if (isImageArtifactMimeType(mimeType)) {
    return { fullBleed: false, kind: "image", language };
  }
  if (isVideoArtifactMimeType(mimeType)) {
    return { fullBleed: false, kind: "video", language };
  }
  if (isHtmlArtifactMimeType(mimeType)) {
    return { fullBleed: true, kind: "html", language };
  }
  if (isSpreadsheet) {
    return { fullBleed: true, kind: "spreadsheet", language };
  }

  const canPreview =
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);

  if (!canPreview) {
    return { fullBleed: false, kind: "download", language };
  }

  if (isMarkdownArtifactMimeType(mimeType) || isWordDocument) {
    return { fullBleed: false, kind: "markdown", language };
  }

  return { fullBleed: false, kind: "text", language };
}

export function PublicArtifactSharePage() {
  const { token = "" } = useParams();
  const { data, isLoading, error: loadError } = usePublicArtifactShare(token);
  const metadata = data?.metadata ?? null;
  const content = data?.content ?? null;
  const error = resolveShareError(token, loadError);
  const loading = token.length > 0 && isLoading;
  const preview = resolveSharePreviewKind(metadata);

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
        preview.fullBleed
          ? "flex h-svh flex-col overflow-hidden"
          : "h-svh overflow-y-auto"
      )}
    >
      <PublicArtifactShareHeader
        downloadUrl={downloadUrl}
        filename={metadata?.filename}
        token={token}
      />

      <main
        className={cn(
          preview.fullBleed
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "mx-auto max-w-5xl px-4 py-6"
        )}
      >
        <PublicArtifactShareBody
          artifact={artifact}
          content={content}
          downloadUrl={downloadUrl}
          error={error}
          filename={metadata?.filename}
          kind={preview.kind}
          language={preview.language}
          loading={loading}
        />
      </main>
    </div>
  );
}

function PublicArtifactShareHeader({
  filename,
  token,
  downloadUrl,
}: {
  filename: string | undefined;
  token: string;
  downloadUrl: string;
}) {
  return (
    <header className="border-border border-b px-3 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-medium text-xs">
          {filename ?? "Shared artifact"}
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
  );
}

function PublicArtifactShareBody({
  loading,
  error,
  artifact,
  kind,
  language,
  content,
  downloadUrl,
  filename,
}: {
  loading: boolean;
  error: string | null;
  artifact: ShareArtifact | null;
  kind: SharePreviewKind;
  language: string | null;
  content: string | null;
  downloadUrl: string;
  filename: string | undefined;
}) {
  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }
  if (artifact && kind !== "download") {
    return (
      <PublicArtifactPreview
        artifact={artifact}
        content={content}
        downloadUrl={downloadUrl}
        kind={kind}
        language={language}
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

function PublicArtifactPreview({
  artifact,
  kind,
  language,
  content,
  downloadUrl,
}: {
  artifact: ShareArtifact;
  kind: Exclude<SharePreviewKind, "download">;
  language: string | null;
  content: string | null;
  downloadUrl: string;
}) {
  if (kind === "image") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview
        error={null}
        imagePreviewUrl={downloadUrl}
        kind="image"
        loading={false}
      />
    );
  }
  if (kind === "video") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview
        error={null}
        kind="video"
        loading={false}
        videoPreviewUrl={downloadUrl}
      />
    );
  }
  if (kind === "html") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview
        content={content}
        error={null}
        htmlSandbox={ARTIFACT_HTML_IFRAME_SANDBOX}
        kind="html"
        loading={false}
      />
    );
  }
  if (kind === "spreadsheet") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview
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
      canPreview
      content={content}
      error={null}
      format={kind === "markdown" ? "markdown" : "plain"}
      kind="text"
      language={language}
      loading={false}
    />
  );
}
