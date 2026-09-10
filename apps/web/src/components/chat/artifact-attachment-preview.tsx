import { Button } from "@nakama/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  File01Icon,
  Image01Icon,
  Video01Icon,
  ViewIcon,
} from "hugeicons-react";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { formatBytes } from "@/lib/knowledge-base-files";

interface ArtifactAttachmentPreviewProps {
  artifact: ChatArtifactRef;
  className?: string;
  id: string;
  profileId: string;
  /** `chip` is the chat attachment chip; `icon` is an icon-only view button. */
  variant?: "chip" | "icon";
}

export function ArtifactAttachmentPreview({
  profileId,
  id,
  artifact,
  className,
  variant = "chip",
}: ArtifactAttachmentPreviewProps) {
  const { imagePreviewUrl, isImage, isVideo, openPanel } =
    useArtifactAttachmentPreviewPanel({
      artifact,
      id,
      profileId,
    });

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
