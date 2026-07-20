import { MessageResponse } from "@/components/ai-elements/message";
import { Spinner } from "@/components/ui/spinner";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import {
  ARTIFACT_HTML_IFRAME_SANDBOX,
  htmlForArtifactPreview,
} from "@/lib/artifact-html-preview";

/** Highlighting a very large file blocks the main thread, so show it as plain text. */
const MAX_HIGHLIGHTED_CHARS = 200_000;

type ArtifactPanelSharedProps = {
  loading: boolean;
  error: string | null;
  canPreview: boolean;
  artifact: ChatArtifactRef;
};

export type ArtifactAttachmentPanelBodyProps =
  | (ArtifactPanelSharedProps & {
      kind: "image";
      imagePreviewUrl?: string | null;
    })
  | (ArtifactPanelSharedProps & {
      kind: "html";
      content: string | null;
      htmlSandbox?: string;
    })
  | (ArtifactPanelSharedProps & {
      kind: "text";
      content: string | null;
      format: "markdown" | "plain";
      language: string | null;
      streaming?: boolean;
    });

function toCodeFence(content: string, language: string): string {
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function renderTextContent({
  content,
  format,
  language,
  streaming = false,
}: {
  content: string;
  format: "markdown" | "plain";
  language: string | null;
  streaming?: boolean;
}) {
  if (format === "markdown") {
    return (
      <MessageResponse className="text-sm" isAnimating={streaming}>
        {content}
      </MessageResponse>
    );
  }

  if (language && content.length <= MAX_HIGHLIGHTED_CHARS) {
    return (
      <MessageResponse className="text-sm" isAnimating={streaming}>
        {toCodeFence(content, language)}
      </MessageResponse>
    );
  }

  return (
    <pre className="max-h-[min(50vh,28rem)] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap text-foreground">
      {content}
    </pre>
  );
}

function LoadingState({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex items-center gap-2 text-sm text-muted-foreground"
          : "flex flex-1 items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
      }
    >
      <Spinner className="size-4" />
      Loading preview…
    </div>
  );
}

function UnavailablePreview({ padded }: { padded: boolean }) {
  return (
    <p className={padded ? "p-4 text-sm text-muted-foreground" : "text-sm text-muted-foreground"}>
      Preview is not available for this file type. Download the artifact instead.
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
      {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
      {!loading && !error && imagePreviewUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <img
            src={imagePreviewUrl}
            alt={artifact.filename}
            className="max-h-[min(70vh,48rem)] max-w-full rounded-lg border border-border bg-muted/20 object-contain"
          />
        </div>
      ) : null}
      {!loading && !error && !imagePreviewUrl && !canPreview ? (
        <UnavailablePreview padded />
      ) : null}
    </div>
  );
}

function ArtifactAttachmentHtmlBody({
  loading,
  error,
  content,
  canPreview,
  artifact,
  htmlSandbox = ARTIFACT_HTML_IFRAME_SANDBOX,
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "html" }>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading ? <LoadingState /> : null}
      {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
      {!loading && !error && content ? (
        <iframe
          title={artifact.filename}
          srcDoc={htmlForArtifactPreview(content)}
          sandbox={htmlSandbox}
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      ) : null}
      {!loading && !error && !content && !canPreview ? <UnavailablePreview padded /> : null}
    </div>
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
}: Extract<ArtifactAttachmentPanelBodyProps, { kind: "text" }>) {
  return (
    <div className="space-y-4">
      {loading ? <LoadingState compact /> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loading && !error && content
        ? renderTextContent({
            content,
            format,
            language,
            streaming,
          })
        : null}
      {!loading && !error && !canPreview ? <UnavailablePreview padded={false} /> : null}
    </div>
  );
}

export function ArtifactAttachmentPanelBody(props: ArtifactAttachmentPanelBodyProps) {
  switch (props.kind) {
    case "image":
      return <ArtifactAttachmentImageBody {...props} />;
    case "html":
      return <ArtifactAttachmentHtmlBody {...props} />;
    case "text":
      return <ArtifactAttachmentTextBody {...props} />;
    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
