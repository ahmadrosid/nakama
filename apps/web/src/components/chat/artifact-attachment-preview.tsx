import { useEffect, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useChatAttachmentPanel } from "@/context/chat-attachment-panel-context";
import {
  artifactCodeLanguage,
  buildArtifactContentUrl,
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

interface ArtifactAttachmentPreviewProps {
  profileId: string;
  id: string;
  artifact: ChatArtifactRef;
  className?: string;
}

/** Highlighting a very large file blocks the main thread, so show it as plain text. */
const MAX_HIGHLIGHTED_CHARS = 200_000;

/**
 * Wrap file content in a markdown code fence, using a fence long enough to survive
 * backtick runs inside the content itself.
 */
function toCodeFence(content: string, language: string): string {
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function downloadActionLabel(mimeType: string): string {
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

export function ArtifactAttachmentPreview({
  profileId,
  id,
  artifact,
  className,
}: ArtifactAttachmentPreviewProps) {
  const { show, update, hide, activeId } = useChatAttachmentPanel();
  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  // The saved mime type can be missing or generic (`application/octet-stream`) for
  // artifacts written without a metadata sidecar, so fall back to the extension.
  const mimeType = resolveArtifactMimeType(artifact.mimeType, artifact.filename);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  // A Word-named file may be a real .docx, a legacy .doc, or HTML in disguise. The
  // server decides from the bytes and hands back Markdown either way.
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) || isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(artifact.filename);
  // An unrecognized extension is not proof of a binary file — `write_file` only ever
  // writes UTF-8 — so fetch it and let the bytes themselves decide.
  const canPreview =
    isHtml ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);
  const downloadLabel = downloadActionLabel(mimeType);

  useEffect(() => {
    // Content is fetched once per artifact and kept: reopening the same file must
    // show it immediately instead of spinning through another round trip.
    if (!open || !canPreview || content !== null) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void client
      .readProfileArtifactContent(profileId, artifact.path, {
        inline: true,
        // A .docx is a ZIP archive; ask the server to convert it to Markdown for preview.
        render: isWordDocument ? "markdown" : undefined,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const contentType = resolveArtifactMimeType(result.contentType, artifact.filename);
        const servedAsHtml = isHtmlArtifactMimeType(contentType);

        // Never let an HTML payload reach the text branch, or a non-HTML payload
        // reach the iframe: the served type must agree with what we are about to render.
        if (isHtml ? !servedAsHtml : servedAsHtml) {
          setError("Preview is not available for this file type. Download instead.");
          return;
        }

        if (
          !isHtml &&
          !isTextArtifactMimeType(contentType) &&
          !looksLikeUtf8Text(new Uint8Array(result.data))
        ) {
          setError("Preview is not available for this file type. Download instead.");
          return;
        }

        setContent(new TextDecoder().decode(result.data));
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(formatError(fetchError));
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
  }, [
    open,
    canPreview,
    content,
    isHtml,
    isWordDocument,
    profileId,
    artifact.path,
    artifact.filename,
  ]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    return () => {
      hide(id);
    };
  }, [hide, id]);

  /**
   * The panel's title, actions, and body are built here and nowhere else. `show()`
   * replaces the whole config rather than merging, so building it in two places let
   * a re-open drop the header actions (the Copy button) until some state changed.
   */
  function buildPanelConfig() {
    return {
      title: artifact.filename,
      headerActions: (
        <>
          <div className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-border bg-muted">
            <button
              type="button"
              className="px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
              disabled={loading && !content}
              onClick={() => void copyArtifact()}
            >
              {copied ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckIcon
                    className="size-3.5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                  Copied
                </span>
              ) : (
                "Copy"
              )}
            </button>
            <div className="w-px self-stretch bg-border" aria-hidden />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="More artifact actions"
                    className="inline-flex items-center justify-center px-1.5 text-foreground transition-colors hover:bg-muted/80"
                  />
                }
              >
                <ChevronDownIcon className="size-3.5" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    const link = document.createElement("a");
                    link.href = downloadUrl;
                    link.download = artifact.filename;
                    link.rel = "noopener";
                    document.body.append(link);
                    link.click();
                    link.remove();
                  }}
                >
                  {downloadLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => setFullscreen((current) => !current)}
          >
            {fullscreen ? (
              <Minimize2Icon className="size-4" aria-hidden />
            ) : (
              <Maximize2Icon className="size-4" aria-hidden />
            )}
          </Button>
        </>
      ),
      resizable: !fullscreen,
      fullscreen,
      bodyClassName: isHtml ? "flex flex-col overflow-hidden p-0" : undefined,
      content: renderPanelBody({
        isHtml,
        isMarkdown,
        language,
        mimeType,
        loading,
        error,
        content,
        canPreview,
        artifact,
      }),
    };
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    update(id, buildPanelConfig());
    // buildPanelConfig is re-created every render, so the primitives it reads are the
    // dependencies here; listing the function itself would loop on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    update,
    id,
    artifact,
    fullscreen,
    isHtml,
    isMarkdown,
    language,
    mimeType,
    loading,
    error,
    content,
    canPreview,
    copied,
    downloadLabel,
    downloadUrl,
  ]);

  async function copyArtifact() {
    try {
      let text = content;
      if (!text) {
        const result = await client.readProfileArtifactContent(profileId, artifact.path, {
          inline: true,
          // Copying the raw bytes of a .docx would put ZIP garbage on the clipboard.
          render: isWordDocument ? "markdown" : undefined,
        });
        text = new TextDecoder().decode(result.data);
        setContent(text);
      }

      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable outside secure contexts.
    }
  }

  function openPanel() {
    setFullscreen(false);
    setCopied(false);
    show({
      ...buildPanelConfig(),
      id,
      defaultWidth: isHtml || isMarkdown || language ? 768 : 448,
      resizable: true,
      fullscreen: false,
      // Already-fetched content reopens instantly; only a cold open spins.
      content: renderPanelBody({
        isHtml,
        isMarkdown,
        language,
        mimeType,
        loading: canPreview && content === null && error === null,
        error,
        content,
        canPreview,
        artifact,
      }),
      onClose: () => {
        setFullscreen(false);
        setCopied(false);
      },
    });
  }

  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-muted px-2 py-2 text-left transition-colors hover:bg-muted/70",
        className,
      )}
      onClick={openPanel}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 max-w-[12rem]">
        <p className="truncate text-xs font-medium text-foreground">{artifact.filename}</p>
        <p className="text-[10px] text-muted-foreground">
          {artifact.sizeBytes > 0 ? `${formatBytes(artifact.sizeBytes)} · ` : null}
          Artifact
        </p>
      </div>
    </button>
  );
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

function renderPanelBody({
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
