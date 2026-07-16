import { useEffect, useState } from "react";
import { FileTextIcon } from "lucide-react";
import { ArtifactAttachmentPanelActions } from "@/components/chat/artifact-attachment-panel-actions";
import {
  ArtifactAttachmentPanelBody,
  downloadActionLabel,
} from "@/components/chat/artifact-attachment-panel-body";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
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
  const mimeType = resolveArtifactMimeType(artifact.mimeType, artifact.filename);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) || isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(artifact.filename);
  const canPreview =
    isHtml ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);
  const downloadLabel = downloadActionLabel(mimeType);

  useEffect(() => {
    if (!open || !canPreview || content !== null) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void client
      .readProfileArtifactContent(profileId, artifact.path, {
        inline: true,
        render: isWordDocument ? "markdown" : undefined,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const contentType = resolveArtifactMimeType(result.contentType, artifact.filename);
        const servedAsHtml = isHtmlArtifactMimeType(contentType);

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

  function buildPanelBody(loadingOverride?: boolean) {
    return (
      <ArtifactAttachmentPanelBody
        isHtml={isHtml}
        isMarkdown={isMarkdown}
        language={language}
        mimeType={mimeType}
        loading={loadingOverride ?? loading}
        error={error}
        content={content}
        canPreview={canPreview}
        artifact={artifact}
      />
    );
  }

  function buildPanelConfig() {
    return {
      title: artifact.filename,
      headerActions: (
        <ArtifactAttachmentPanelActions
          copied={copied}
          loading={loading}
          content={content}
          fullscreen={fullscreen}
          downloadLabel={downloadLabel}
          downloadUrl={downloadUrl}
          filename={artifact.filename}
          onCopy={() => void copyArtifact()}
          onToggleFullscreen={() => setFullscreen((current) => !current)}
        />
      ),
      resizable: !fullscreen,
      fullscreen,
      bodyClassName: isHtml ? "flex flex-col overflow-hidden p-0" : undefined,
      content: buildPanelBody(),
    };
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    update(id, buildPanelConfig());
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
      content: buildPanelBody(canPreview && content === null && error === null),
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
