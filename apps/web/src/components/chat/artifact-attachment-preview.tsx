import {
  File01Icon,
  Image01Icon,
  Video01Icon,
  ViewIcon,
} from "hugeicons-react";
import { useEffect, useState } from "react";
import { ArtifactAttachmentPanelActions } from "@/components/chat/artifact-attachment-panel-actions";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactCanTogglePreviewSource,
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelHeaderMeta,
  downloadActionLabel,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import {
  type ArtifactPreviewMode,
  ArtifactPreviewModeToggle,
} from "@/components/chat/artifact-preview-mode-toggle";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { useArtifactPreviewContent } from "@/components/chat/use-artifact-preview-content";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
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
  type ChatArtifactRef,
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
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

interface ArtifactAttachmentPreviewProps {
  artifact: ChatArtifactRef;
  className?: string;
  id: string;
  profileId: string;
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
  previewMode,
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
  previewMode: ArtifactPreviewMode;
}) {
  if (kind === "image") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        error={error}
        imagePreviewUrl={imagePreviewUrl}
        kind="image"
        loading={loading}
      />
    );
  }

  if (kind === "video") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        error={error}
        kind="video"
        loading={loading}
        videoPreviewUrl={videoPreviewUrl}
      />
    );
  }

  if (kind === "html") {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        content={content}
        error={error}
        kind="html"
        loading={loading}
        previewMode={previewMode}
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      artifact={artifact}
      canPreview={canPreview}
      content={content}
      error={error}
      format={textFormat}
      kind="text"
      language={language}
      loading={loading}
      previewMode={previewMode}
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
  const share = useArtifactShareControls({
    artifactPath: artifact.path,
    profileId,
  });
  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] =
    useState<ArtifactPreviewMode>("preview");
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  const mimeType = resolveArtifactMimeType(
    artifact.mimeType,
    artifact.filename
  );
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isVideo = isVideoArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const showPreviewToggle = artifactCanTogglePreviewSource({
    isHtml,
    isMarkdown,
  });
  const header = artifactPanelHeaderMeta({
    filename: artifact.filename,
    mimeType,
    showPreviewToggle,
    sizeBytes: artifact.sizeBytes,
  });
  const language = artifactCodeLanguage(artifact.filename);
  const canPreview =
    isHtml ||
    isImage ||
    isVideo ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);
  const downloadLabel = downloadActionLabel(mimeType);
  const {
    loading,
    error,
    content,
    imagePreviewUrl,
    videoPreviewUrl,
    setContent,
  } = useArtifactPreviewContent({
    artifact,
    canPreview,
    isHtml,
    isImage,
    isVideo,
    isWordDocument,
    open,
    profileId,
  });

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function buildPanelBody(
    loadingOverride?: boolean,
    mode: ArtifactPreviewMode = previewMode
  ) {
    const panelKind = isImage
      ? "image"
      : isVideo
        ? "video"
        : isHtml
          ? "html"
          : "text";
    return (
      <ArtifactAttachmentPreviewPanelBody
        artifact={artifact}
        canPreview={canPreview}
        content={content}
        error={error}
        imagePreviewUrl={imagePreviewUrl}
        kind={panelKind}
        language={language}
        loading={loadingOverride ?? loading}
        previewMode={mode}
        textFormat={isMarkdown ? "markdown" : "plain"}
        videoPreviewUrl={videoPreviewUrl}
      />
    );
  }

  function buildPanelConfig(mode: ArtifactPreviewMode = previewMode) {
    return {
      bodyClassName: artifactPanelBodyClassName({
        isHtml,
        isImage,
        isMarkdown,
        isVideo,
        previewMode: mode,
      }),
      content: buildPanelBody(undefined, mode),
      fullscreen,
      headerActions: (
        <>
          <ArtifactAttachmentPanelActions
            additionalMenuItems={<ArtifactShareMenuItem share={share} />}
            content={content}
            copied={copied}
            copyDisabled={isImage || isVideo}
            downloadLabel={downloadLabel}
            downloadUrl={downloadUrl}
            filename={artifact.filename}
            fullscreen={fullscreen}
            loading={loading}
            onCopy={() => void copyArtifact()}
            onToggleFullscreen={() => setFullscreen((current) => !current)}
          />
          <ArtifactSharePublishDialogFromState
            artifactPath={artifact.path}
            share={share}
          />
        </>
      ),
      leading: showPreviewToggle ? (
        <ArtifactPreviewModeToggle mode={mode} onChange={setPreviewMode} />
      ) : null,
      resizable: !fullscreen,
      subtitle: header.subtitle,
      title: header.title,
      typeLabel: header.typeLabel,
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
    previewMode,
    showPreviewToggle,
    header.subtitle,
    header.title,
    header.typeLabel,
  ]);

  async function copyArtifact() {
    if (isImage || isVideo) {
      return;
    }

    try {
      let text = content;
      if (!text) {
        const result = await client.readProfileArtifactContent(
          profileId,
          artifact.path,
          {
            inline: true,
            render: isWordDocument ? "markdown" : undefined,
          }
        );
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
    setPreviewMode("preview");
    show({
      ...buildPanelConfig("preview"),
      content: buildPanelBody(
        canPreview &&
          (isImage || isVideo
            ? (isImage ? imagePreviewUrl : videoPreviewUrl) === null
            : content === null) &&
          error === null,
        "preview"
      ),
      defaultWidth: artifactPanelDefaultWidth(artifact.filename, mimeType),
      fullscreen: false,
      id,
      onClose: () => {
        setFullscreen(false);
        setCopied(false);
        setPreviewMode("preview");
      },
      resizable: true,
    });
  }

  return (
    <ArtifactAttachmentPreviewTrigger
      artifact={artifact}
      className={className}
      imagePreviewUrl={imagePreviewUrl}
      isImage={isImage}
      isVideo={isVideo}
      onOpen={openPanel}
      variant={variant}
    />
  );
}

function ArtifactAttachmentPreviewTrigger({
  artifact,
  className,
  imagePreviewUrl,
  isImage,
  isVideo,
  onOpen,
  variant,
}: {
  artifact: ChatArtifactRef;
  className?: string;
  imagePreviewUrl: string | null;
  isImage: boolean;
  isVideo: boolean;
  onOpen: () => void;
  variant: "chip" | "icon";
}) {
  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="View"
              className={className}
              onClick={onOpen}
              size="icon-sm"
              title="View"
              type="button"
              variant="outline"
            >
              <ViewIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          View
        </TooltipContent>
      </Tooltip>
    );
  }

  if (isImage) {
    return (
      <button
        className={cn(
          "relative flex w-1/2 max-w-full shrink-0 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-muted p-2 text-left transition-colors hover:bg-muted/70",
          className
        )}
        onClick={onOpen}
        type="button"
      >
        {imagePreviewUrl ? (
          <img
            alt=""
            className="aspect-[4/3] w-full rounded-md border border-border object-cover outline outline-1 outline-black/10 dark:outline-white/10"
            src={imagePreviewUrl}
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border bg-background">
            <Image01Icon aria-hidden className="size-6 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 px-0.5">
          <p className="truncate font-medium text-foreground text-xs">
            {artifact.filename}
          </p>
          <p className="text-2xs text-muted-foreground">
            {artifact.sizeBytes > 0
              ? `${formatBytes(artifact.sizeBytes)} · `
              : null}
            Artifact
          </p>
        </div>
      </button>
    );
  }

  return (
    <button
      className={cn(
        "relative inline-flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-muted px-2 py-2 text-left transition-colors hover:bg-muted/70",
        className
      )}
      onClick={onOpen}
      type="button"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        {isVideo ? (
          <Video01Icon aria-hidden className="size-4 text-muted-foreground" />
        ) : (
          <File01Icon aria-hidden className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 max-w-[12rem]">
        <p className="truncate font-medium text-foreground text-xs">
          {artifact.filename}
        </p>
        <p className="text-2xs text-muted-foreground">
          {artifact.sizeBytes > 0
            ? `${formatBytes(artifact.sizeBytes)} · `
            : null}
          Artifact
        </p>
      </div>
    </button>
  );
}
