import { useMemo, useRef } from "react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { MessageResponse } from "@/components/ai-elements/message";
import { ArtifactMarkdownToc } from "@/components/chat/artifact-markdown-toc";
import type { ArtifactPreviewMode } from "@/components/chat/artifact-preview-mode-toggle";
import { SpreadsheetGrid } from "@/components/chat/artifact-spreadsheet-editor";
import { Spinner } from "@/components/ui/spinner";
import {
  ARTIFACT_HTML_IFRAME_SANDBOX,
  htmlForArtifactPreview,
} from "@/lib/artifact-html-preview";
import { parseSpreadsheetText } from "@/lib/artifact-spreadsheet";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { extractMarkdownHeadings } from "@/lib/markdown-toc";
import { cn } from "@/lib/utils";

type ArtifactPanelSharedProps = {
  loading: boolean;
  error: string | null;
  canPreview: boolean;
  artifact: ChatArtifactRef;
  previewMode?: ArtifactPreviewMode;
};

export type ArtifactAttachmentPanelBodyProps =
  | (ArtifactPanelSharedProps & {
      kind: "image";
      imagePreviewUrl?: string | null;
    })
  | (ArtifactPanelSharedProps & {
      kind: "video";
      videoPreviewUrl?: string | null;
    })
  | (ArtifactPanelSharedProps & {
      kind: "html";
      content: string | null;
      htmlSandbox?: string;
    })
  | (ArtifactPanelSharedProps & {
      kind: "spreadsheet";
      content: string | null;
    })
  | (ArtifactPanelSharedProps & {
      kind: "text";
      content: string | null;
      format: "markdown" | "plain";
      language: string | null;
      streaming?: boolean;
    });

function renderTextContent({
  content,
  format,
  language,
  streaming = false,
  fillHeight = false,
}: {
  content: string;
  format: "markdown" | "plain";
  language: string | null;
  streaming?: boolean;
  fillHeight?: boolean;
}) {
  if (format === "markdown") {
    return (
      <MessageResponse className="text-sm" isAnimating={streaming}>
        {content}
      </MessageResponse>
    );
  }

  return (
    <CodeBlock
      className="rounded-none border-0"
      code={content}
      fillHeight={fillHeight}
      lang={language}
    />
  );
}

type ArtifactBodyPhase =
  | "loading"
  | "error"
  | "source"
  | "content"
  | "unavailable"
  | "empty";

function resolveArtifactBodyPhase({
  canPreview,
  error,
  hasContent,
  loading,
  showSource,
}: {
  canPreview: boolean;
  error: string | null;
  hasContent: boolean;
  loading: boolean;
  showSource: boolean;
}): ArtifactBodyPhase {
  if (loading) {
    return "loading";
  }
  if (error) {
    return "error";
  }
  if (hasContent && showSource) {
    return "source";
  }
  if (hasContent) {
    return "content";
  }
  if (canPreview) {
    return "empty";
  }
  return "unavailable";
}

function ArtifactBodyError({
  compact,
  error,
}: {
  compact?: boolean;
  error: string;
}) {
  return (
    <p
      className={
        compact ? "text-destructive text-sm" : "p-4 text-destructive text-sm"
      }
    >
      {error}
    </p>
  );
}

function LoadingState({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex items-center gap-2 text-muted-foreground text-sm"
          : "flex flex-1 items-center justify-center gap-2 p-4 text-muted-foreground text-sm"
      }
    >
      <Spinner className="size-4" />
      Loading preview…
    </div>
  );
}

function UnavailablePreview({ padded }: { padded: boolean }) {
  return (
    <p
      className={
        padded
          ? "p-4 text-muted-foreground text-sm"
          : "text-muted-foreground text-sm"
      }
    >
      Preview is not available for this file type. Download the artifact
      instead.
    </p>
  );
}

function ArtifactAttachmentImageBody({
  loading,
  error,
  imagePreviewUrl = null,
  canPreview,
  artifact,
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "image" }>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading ? <LoadingState /> : null}
      {error ? <p className="p-4 text-destructive text-sm">{error}</p> : null}
      {!(loading || error) && imagePreviewUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <img
            alt={artifact.filename}
            className="max-h-[min(70vh,48rem)] max-w-full rounded-lg border border-border bg-muted/20 object-contain"
            src={imagePreviewUrl}
          />
        </div>
      ) : null}
      {loading || error || imagePreviewUrl || canPreview ? null : (
        <UnavailablePreview padded />
      )}
    </div>
  );
}

function ArtifactAttachmentVideoBody({
  loading,
  error,
  videoPreviewUrl = null,
  canPreview,
  artifact,
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "video" }>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading ? <LoadingState /> : null}
      {error ? <p className="p-4 text-destructive text-sm">{error}</p> : null}
      {!(loading || error) && videoPreviewUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <video
            aria-label={artifact.filename}
            className="max-h-[min(70vh,48rem)] w-full max-w-[min(100%,24rem)] rounded-lg border border-border bg-black object-contain"
            controls
            playsInline
            preload="metadata"
            src={videoPreviewUrl}
          />
        </div>
      ) : null}
      {loading || error || videoPreviewUrl || canPreview ? null : (
        <UnavailablePreview padded />
      )}
    </div>
  );
}

function ArtifactHtmlPreview({
  content,
  filename,
  htmlSandbox,
}: {
  content: string;
  filename: string;
  htmlSandbox: string;
}) {
  return (
    <iframe
      className="min-h-0 w-full flex-1 border-0 bg-background"
      sandbox={htmlSandbox}
      srcDoc={htmlForArtifactPreview(content)}
      title={filename}
    />
  );
}

function ArtifactAttachmentHtmlBody({
  loading,
  error,
  content,
  canPreview,
  artifact,
  htmlSandbox = ARTIFACT_HTML_IFRAME_SANDBOX,
  previewMode = "preview",
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "html" }>) {
  const phase = resolveArtifactBodyPhase({
    canPreview,
    error,
    hasContent: Boolean(content),
    loading,
    showSource: previewMode === "source" && Boolean(content),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {phase === "loading" ? <LoadingState /> : null}
      {phase === "error" && error ? <ArtifactBodyError error={error} /> : null}
      {phase === "source" && content
        ? renderTextContent({
            content,
            fillHeight: true,
            format: "plain",
            language: "html",
          })
        : null}
      {phase === "content" && content ? (
        <ArtifactHtmlPreview
          content={content}
          filename={artifact.filename}
          htmlSandbox={htmlSandbox}
        />
      ) : null}
      {phase === "unavailable" ? <UnavailablePreview padded /> : null}
    </div>
  );
}

function resolveTextSourceView(
  previewMode: ArtifactPreviewMode,
  format: "markdown" | "plain",
  language: string | null
): { sourceFormat: "markdown" | "plain"; sourceLanguage: string | null } {
  if (previewMode === "source") {
    return {
      sourceFormat: "plain",
      sourceLanguage: language ?? (format === "markdown" ? "markdown" : null),
    };
  }
  return { sourceFormat: format, sourceLanguage: language };
}

function ArtifactTextRendered({
  content,
  rendered,
  sourceFormat,
}: {
  content: string;
  rendered: ReturnType<typeof renderTextContent>;
  sourceFormat: "markdown" | "plain";
}) {
  const renderedRef = useRef<HTMLDivElement>(null);
  const headings = useMemo(
    () => (sourceFormat === "markdown" ? extractMarkdownHeadings(content) : []),
    [content, sourceFormat]
  );

  if (sourceFormat !== "markdown") {
    return rendered;
  }

  return (
    <>
      <ArtifactMarkdownToc contentRef={renderedRef} headings={headings} />
      <div ref={renderedRef}>{rendered}</div>
    </>
  );
}

function ArtifactAttachmentTextBody({
  loading,
  error,
  content,
  format,
  language,
  streaming = false,
  canPreview,
  previewMode = "preview",
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "text" }>) {
  const { sourceFormat, sourceLanguage } = resolveTextSourceView(
    previewMode,
    format,
    language
  );
  const showCodeBlock = Boolean(content && sourceFormat !== "markdown");
  const showContent = !(loading || error) && Boolean(content);
  const showUnavailable = !(loading || error || canPreview);
  const rendered = content
    ? renderTextContent({
        content,
        fillHeight: showCodeBlock,
        format: sourceFormat,
        language: sourceLanguage,
        streaming,
      })
    : null;

  return (
    <div
      className={cn(
        showCodeBlock ? "flex min-h-0 flex-1 flex-col" : "space-y-4"
      )}
    >
      {loading ? <LoadingState compact /> : null}
      {error ? <ArtifactBodyError compact error={error} /> : null}
      {showContent && rendered ? (
        <ArtifactTextRendered
          content={content}
          rendered={rendered}
          sourceFormat={sourceFormat}
        />
      ) : null}
      {showUnavailable ? <UnavailablePreview padded={false} /> : null}
    </div>
  );
}

function ArtifactSpreadsheetPreview({
  content,
  filename,
}: {
  content: string;
  filename: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SpreadsheetGrid
        editable={false}
        rows={parseSpreadsheetText(filename, content)}
      />
    </div>
  );
}

function ArtifactAttachmentSpreadsheetBody({
  loading,
  error,
  content,
  canPreview,
  artifact,
  previewMode = "preview",
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "spreadsheet" }>) {
  const phase = resolveArtifactBodyPhase({
    canPreview,
    error,
    hasContent: Boolean(content),
    loading,
    showSource: previewMode === "source" && Boolean(content),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {phase === "loading" ? <LoadingState /> : null}
      {phase === "error" && error ? <ArtifactBodyError error={error} /> : null}
      {phase === "source" && content
        ? renderTextContent({
            content,
            fillHeight: true,
            format: "plain",
            language: null,
          })
        : null}
      {phase === "content" && content ? (
        <ArtifactSpreadsheetPreview
          content={content}
          filename={artifact.filename}
        />
      ) : null}
      {phase === "unavailable" ? <UnavailablePreview padded /> : null}
    </div>
  );
}

export function ArtifactAttachmentPanelBody(
  props: ArtifactAttachmentPanelBodyProps
) {
  switch (props.kind) {
    case "image":
      return <ArtifactAttachmentImageBody {...props} />;
    case "video":
      return <ArtifactAttachmentVideoBody {...props} />;
    case "html":
      return <ArtifactAttachmentHtmlBody {...props} />;
    case "spreadsheet":
      return <ArtifactAttachmentSpreadsheetBody {...props} />;
    case "text":
      return <ArtifactAttachmentTextBody {...props} />;
    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
