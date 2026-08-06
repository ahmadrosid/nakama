import { useEffect, useState } from "react";
import { EyeIcon, FileTextIcon, FilmIcon, ImageIcon } from "lucide-react";
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
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelSubtitle,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import { useArtifactPreviewContent } from "@/components/chat/use-artifact-preview-content";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  isVideoArtifactMimeType,
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
  /** `chip` is the chat attachment chip; `icon` is an icon-only view button. */
  variant?: "chip" | "icon";
}

function ArtifactAttachmentPreviewPanelBody({
  kind,
  textFormat,
  language,
  loading,
  error,
  content,
  imagePreviewUrl,
  videoPreviewUrl,
  canPreview,
  artifact,
}: {
  kind: "image" | "video" | "html" | "text";
  textFormat: "markdown" | "plain";
  language: string | null;
  loading: boolean;
  error: string | null;
  content: string | null;
  imagePreviewUrl: string | null;
  videoPreviewUrl: string | null;
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

  if (kind === "video") {
    return (
      <ArtifactAttachmentPanelBody
        kind="video"
        loading={loading}
        error={error}
        videoPreviewUrl={videoPreviewUrl}
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
  variant = "chip",
}: ArtifactAttachmentPreviewProps) {
  const { show, update, activeId } = useChatAttachmentPanel();
  const share = useArtifactShareControls({ profileId, artifactPath: artifact.path });
  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  const mimeType = resolveArtifactMimeType(artifact.mimeType, artifact.filename);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isVideo = isVideoArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) || isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(artifact.filename);
  const canPreview =
    isHtml ||
    isImage ||
    isVideo ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);
  const downloadLabel = downloadActionLabel(mimeType);
  const { loading, error, content, imagePreviewUrl, videoPreviewUrl, setContent } =
    useArtifactPreviewContent({
      open,
      canPreview,
      isHtml,
      isImage,
      isVideo,
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

  function buildPanelBody(loadingOverride?: boolean) {
    const panelKind = isImage ? "image" : isVideo ? "video" : isHtml ? "html" : "text";
    return (
      <ArtifactAttachmentPreviewPanelBody
        kind={panelKind}
        textFormat={isMarkdown ? "markdown" : "plain"}
        language={language}
        loading={loadingOverride ?? loading}
        error={error}
        content={content}
        imagePreviewUrl={imagePreviewUrl}
        videoPreviewUrl={videoPreviewUrl}
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
            copyDisabled={isImage || isVideo}
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
      bodyClassName: artifactPanelBodyClassName({
        isHtml,
        isImage,
        isVideo,
        isMarkdown,
      }),
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
    isVideo,
    isMarkdown,
    language,
    mimeType,
    loading,
    error,
    content,
    imagePreviewUrl,
    videoPreviewUrl,
    canPreview,
    copied,
    downloadLabel,
    downloadUrl,
    share.busy,
    share.publishDialogOpen,
  ]);

  async function copyArtifact() {
    if (isImage || isVideo) {
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
          (isImage || isVideo
            ? (isImage ? imagePreviewUrl : videoPreviewUrl) === null
            : content === null) &&
          error === null,
      ),
      onClose: () => {
        setFullscreen(false);
        setCopied(false);
      },
    });
  }

  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="View"
              title="View"
              className={className}
              onClick={openPanel}
            >
              <EyeIcon className="size-3.5" aria-hidden />
            </Button>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          View
        </TooltipContent>
      </Tooltip>
    );
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
        ) : isVideo ? (
          <FilmIcon className="size-4 text-muted-foreground" aria-hidden />
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
