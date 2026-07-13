import { useEffect, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  buildArtifactContentUrl,
  isHtmlArtifactMimeType,
  isTextArtifactMimeType,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

interface ArtifactAttachmentPreviewProps {
  profileId: string;
  artifact: ChatArtifactRef;
  className?: string;
}

function downloadActionLabel(mimeType: string, filename: string): string {
  if (isHtmlArtifactMimeType(mimeType) || filename.toLowerCase().endsWith(".html") || filename.toLowerCase().endsWith(".htm")) {
    return "Download as HTML";
  }

  if (mimeType === "text/markdown" || filename.toLowerCase().endsWith(".md")) {
    return "Download as Markdown";
  }

  if (mimeType === "application/json" || filename.toLowerCase().endsWith(".json")) {
    return "Download as JSON";
  }

  return "Download";
}

export function ArtifactAttachmentPreview({
  profileId,
  artifact,
  className,
}: ArtifactAttachmentPreviewProps) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  const isHtml = isHtmlArtifactMimeType(artifact.mimeType);
  const canPreviewText = isTextArtifactMimeType(artifact.mimeType) && !isHtml;
  const canPreview = isHtml || canPreviewText;
  const downloadLabel = downloadActionLabel(artifact.mimeType, artifact.filename);

  useEffect(() => {
    if (!open || !canPreview) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    void client
      .readProfileArtifactContent(profileId, artifact.path, { inline: true })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const contentType = result.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
        if (isHtml) {
          if (!isHtmlArtifactMimeType(contentType) && contentType !== "application/octet-stream") {
            setError("Preview is not available for this file type. Download instead.");
            return;
          }

          setContent(new TextDecoder().decode(result.data));
          return;
        }

        if (!isTextArtifactMimeType(contentType) || isHtmlArtifactMimeType(contentType)) {
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
  }, [open, canPreview, isHtml, profileId, artifact.path]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setFullscreen(false);
      setCopied(false);
    }
  }

  async function copyArtifact() {
    try {
      let text = content;
      if (!text) {
        const result = await client.readProfileArtifactContent(profileId, artifact.path, {
          inline: true,
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

  const headerActions = (
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
              <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
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
  );

  return (
    <>
      <button
        type="button"
        className={cn(
          "relative inline-flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-muted px-2 py-2 text-left transition-colors hover:bg-muted/70",
          className,
        )}
        onClick={() => setOpen(true)}
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

      <AttachmentDetailPanel
        open={open}
        onOpenChange={handleOpenChange}
        title={artifact.filename}
        headerActions={headerActions}
        className={cn(
          isHtml && !fullscreen && "max-w-3xl",
          fullscreen && "inset-0 max-w-none border-l-0",
        )}
        bodyClassName={isHtml ? "flex flex-col overflow-hidden p-0" : undefined}
      >
        {isHtml ? (
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
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{artifact.mimeType}</span>
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

            {!loading && !error && content ? (
              <pre className="max-h-[min(50vh,28rem)] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap text-foreground">
                {content}
              </pre>
            ) : null}

            {!loading && !error && !canPreview ? (
              <p className="text-sm text-muted-foreground">
                Preview is not available for this file type. Download the artifact instead.
              </p>
            ) : null}
          </div>
        )}
      </AttachmentDetailPanel>
    </>
  );
}
