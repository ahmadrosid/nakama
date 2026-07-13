import { useEffect, useState } from "react";
import { FileDownIcon, FileTextIcon } from "lucide-react";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { Button } from "@/components/ui/button";
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

export function ArtifactAttachmentPreview({
  profileId,
  artifact,
  className,
}: ArtifactAttachmentPreviewProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  const isHtml = isHtmlArtifactMimeType(artifact.mimeType);
  const canPreviewText = isTextArtifactMimeType(artifact.mimeType) && !isHtml;
  const canPreview = isHtml || canPreviewText;

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

  const downloadAction = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Download ${artifact.filename}`}
      render={<a href={downloadUrl} download={artifact.filename} />}
    >
      <FileDownIcon className="size-4" aria-hidden />
    </Button>
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
        onOpenChange={setOpen}
        title={artifact.filename}
        headerActions={downloadAction}
        className={isHtml ? "max-w-3xl" : undefined}
        bodyClassName={isHtml ? "flex flex-col overflow-hidden p-0" : undefined}
      >
        {isHtml ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span>{artifact.mimeType}</span>
              {artifact.sizeBytes > 0 ? (
                <>
                  <span>·</span>
                  <span>{formatBytes(artifact.sizeBytes)}</span>
                </>
              ) : null}
            </div>

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
