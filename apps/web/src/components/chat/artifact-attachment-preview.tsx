import { useEffect, useState } from "react";
import { FileTextIcon, ImageIcon } from "lucide-react";
import { ArtifactAttachmentPanelActions } from "@/components/chat/artifact-attachment-panel-actions";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
import {
  ArtifactAttachmentPanelBody,
} from "@/components/chat/artifact-attachment-panel-body";
import {
  downloadActionLabel,
  artifactPanelDefaultWidth,
  artifactPanelSubtitle,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import { useArtifactPreviewContent } from "@/components/chat/use-artifact-preview-content";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  artifactCodeLanguage,
  buildArtifactContentUrl,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  resolveArtifactMimeType,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

interface ArtifactAttachmentPreviewProps {
  profileId: string;
  id: string;
  artifact: ChatArtifactRef;
  className?: string;
}

function ArtifactAttachmentPreviewPanelBody({
  kind,
  textFormat,
  language,
  loading,
  error,
  content,
  imagePreviewUrl,
  canPreview,
  artifact,
}: {
  kind: "image" | "html" | "text";
  textFormat: "markdown" | "plain";
  language: string | null;
  loading: boolean;
  error: string | null;
  content: string | null;
  imagePreviewUrl: string | null;
  canPreview: boolean;
  artifact: ChatArtifactRef;
}) {
  if (kind === "image") {
    return (
      <ArtifactAttachmentPanelBody
        kind="image"
        loading={loading}
        error={error}
        imagePreviewUrl={imagePreviewUrl}
        canPreview={canPreview}
        artifact={artifact}
      />
    );
  }

  if (kind === "html") {
    return (
      <ArtifactAttachmentPanelBody
        kind="html"
        loading={loading}
        error={error}
        content={content}
        canPreview={canPreview}
        artifact={artifact}
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      kind="text"
      format={textFormat}
      language={language}
      loading={loading}
      error={error}
      content={content}
      canPreview={canPreview}
      artifact={artifact}
    />
  );
}

export function ArtifactAttachmentPreview({
  profileId,
  id,
  artifact,
  className,
}: ArtifactAttachmentPreviewProps) {
  const { show, update, hide, activeId } = useChatAttachmentPanel();
  const share = useArtifactShareControls({ profileId, artifactPath: artifact.path });
  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  const mimeType = resolveArtifactMimeType(artifact.mimeType, artifact.filename);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) || isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(artifact.filename);
  const canPreview =
    isHtml ||
    isImage ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);
  const downloadLabel = downloadActionLabel(mimeType);
  const { loading, error, content, imagePreviewUrl, setContent } = useArtifactPreviewContent({
    open,
    canPreview,
    isHtml,
    isImage,
    isWordDocument,
    profileId,
    artifact,
  });

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
    const panelKind = isImage ? "image" : isHtml ? "html" : "text";
    return (
      <ArtifactAttachmentPreviewPanelBody
        kind={panelKind}
        textFormat={isMarkdown ? "markdown" : "plain"}
        language={language}
        loading={loadingOverride ?? loading}
        error={error}
        content={content}
        imagePreviewUrl={imagePreviewUrl}
        canPreview={canPreview}
        artifact={artifact}
      />
    );
  }

  function buildPanelConfig() {
    return {
      title: artifact.filename,
      subtitle: artifactPanelSubtitle({
        mimeType,
        sizeBytes: artifact.sizeBytes,
      }),
      headerActions: (
        <>
          <ArtifactAttachmentPanelActions
            copied={copied}
            loading={loading}
            content={content}
            copyDisabled={isImage}
            fullscreen={fullscreen}
            downloadLabel={downloadLabel}
            downloadUrl={downloadUrl}
            filename={artifact.filename}
            onCopy={() => void copyArtifact()}
            onToggleFullscreen={() => setFullscreen((current) => !current)}
            additionalMenuItems={<ArtifactShareMenuItem share={share} />}
          />
          <ArtifactSharePublishDialogFromState
            share={share}
            artifactPath={artifact.path}
          />
        </>
      ),
      resizable: !fullscreen,
      fullscreen,
      bodyClassName:
        isHtml || isImage ? "flex flex-col overflow-hidden p-0" : undefined,
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
    isImage,
    isMarkdown,
    language,
    mimeType,
    loading,
    error,
    content,
    imagePreviewUrl,
    canPreview,
    copied,
    downloadLabel,
    downloadUrl,
    share.busy,
    share.publishDialogOpen,
  ]);

  async function copyArtifact() {
    if (isImage) {
      return;
    }

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
      defaultWidth: artifactPanelDefaultWidth(artifact.filename, mimeType),
      resizable: true,
      fullscreen: false,
      content: buildPanelBody(
        canPreview &&
          (isImage ? imagePreviewUrl === null : content === null) &&
          error === null,
      ),
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
        {isImage ? (
          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
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
