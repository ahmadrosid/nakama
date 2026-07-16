import { MessageResponse } from "@/components/ai-elements/message";
import { Spinner } from "@/components/ui/spinner";
import {
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { formatBytes } from "@/lib/knowledge-base-files";

/** Highlighting a very large file blocks the main thread, so show it as plain text. */
const MAX_HIGHLIGHTED_CHARS = 200_000;

function toCodeFence(content: string, language: string): string {
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function renderTextContent({
  content,
  isMarkdown,
  language,
}: {
  content: string;
  isMarkdown: boolean;
  language: string | null;
}) {
  if (isMarkdown) {
    return <MessageResponse className="text-sm">{content}</MessageResponse>;
  }

  if (language && content.length <= MAX_HIGHLIGHTED_CHARS) {
    return <MessageResponse className="text-sm">{toCodeFence(content, language)}</MessageResponse>;
  }

  return (
    <pre className="max-h-[min(50vh,28rem)] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap text-foreground">
      {content}
    </pre>
  );
}

export function ArtifactAttachmentPanelBody({
  isHtml,
  isMarkdown,
  language,
  mimeType,
  loading,
  error,
  content,
  canPreview,
  artifact,
}: {
  isHtml: boolean;
  isMarkdown: boolean;
  language: string | null;
  mimeType: string;
  loading: boolean;
  error: string | null;
  content: string | null;
  canPreview: boolean;
  artifact: ChatArtifactRef;
}) {
  if (isHtml) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading preview…
          </div>
        ) : null}

        {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}

        {!loading && !error && content ? (
          <iframe
            title={artifact.filename}
            srcDoc={content}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
        ) : null}

        {!loading && !error && !content && !canPreview ? (
          <p className="p-4 text-sm text-muted-foreground">
            Preview is not available for this file type. Download the artifact instead.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{mimeType}</span>
        {artifact.sizeBytes > 0 ? (
          <>
            <span>·</span>
            <span>{formatBytes(artifact.sizeBytes)}</span>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading preview…
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading && !error && content ? renderTextContent({ content, isMarkdown, language }) : null}

      {!loading && !error && !canPreview ? (
        <p className="text-sm text-muted-foreground">
          Preview is not available for this file type. Download the artifact instead.
        </p>
      ) : null}
    </div>
  );
}

export function downloadActionLabel(mimeType: string): string {
  if (isHtmlArtifactMimeType(mimeType)) {
    return "Download as HTML";
  }

  if (isDocxFile("", mimeType) || isLegacyDocFile("", mimeType)) {
    return "Download as Word";
  }

  if (isMarkdownArtifactMimeType(mimeType)) {
    return "Download as Markdown";
  }

  if (mimeType === "application/json") {
    return "Download as JSON";
  }

  return "Download";
}
