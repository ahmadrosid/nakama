import { Button } from "@nakama/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  ArrowExpand01Icon,
  Download04Icon,
  File01Icon,
  Image01Icon,
  Video01Icon,
  ViewIcon,
} from "hugeicons-react";
import { useState } from "react";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import {
  buildArtifactContentUrl,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";

interface ArtifactAttachmentPreviewProps {
  artifact: ChatArtifactRef;
  className?: string;
  id: string;
  profileId: string;
  /** `overlay` makes the containing file card the preview target. */
  variant?: "chip" | "icon" | "overlay";
}

export function ArtifactAttachmentPreview({
  profileId,
  id,
  artifact,
  className,
  variant = "chip",
}: ArtifactAttachmentPreviewProps) {
  // Preview, download, share and save all go through this id.
  const ownerProfileId = artifact.ownerProfileId ?? profileId;

  const { imagePreviewUrl, isImage, isVideo, openPanel } =
    useArtifactAttachmentPreviewPanel({
      artifact,
      id,
      profileId: ownerProfileId,
    });

  if (isImage && variant === "chip") {
    return (
      <ArtifactImageCard
        artifact={artifact}
        className={className}
        downloadUrl={`${client.baseUrl}${buildArtifactContentUrl(ownerProfileId, artifact.path)}`}
        imagePreviewUrl={imagePreviewUrl}
        onOpen={openPanel}
      />
    );
  }

  return (
    <ArtifactAttachmentPreviewTrigger
      artifact={artifact}
      className={className}
      isVideo={isVideo}
      onOpen={openPanel}
      variant={variant}
    />
  );
}

function ArtifactAttachmentPreviewTrigger({
  artifact,
  className,
  isVideo,
  onOpen,
  variant,
}: {
  artifact: ChatArtifactRef;
  className?: string;
  isVideo: boolean;
  onOpen: () => void;
  variant: "chip" | "icon" | "overlay";
}) {
  if (variant === "overlay") {
    return (
      <button
        aria-label={`View ${artifact.filename}`}
        className={cn(
          "absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          className
        )}
        onClick={onOpen}
        type="button"
      />
    );
  }

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

const IMAGE_ACTION_CLASS =
  "inline-flex size-11 items-center justify-center rounded-xl bg-black/70 text-white transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

const IMAGE_META_CLASS =
  "rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs";

/** An image in chat: the picture leads, with download and full size on it. */
function ArtifactImageCard({
  artifact,
  className,
  downloadUrl,
  imagePreviewUrl,
  onOpen,
}: {
  artifact: ChatArtifactRef;
  className?: string;
  downloadUrl: string;
  imagePreviewUrl: string | null;
  onOpen: () => void;
}) {
  const [dimensions, setDimensions] = useState<string | null>(null);

  return (
    <figure
      className={cn("m-0 flex w-full max-w-[30rem] flex-col gap-2", className)}
    >
      <div className="relative overflow-hidden rounded-2xl bg-muted">
        {imagePreviewUrl ? (
          <img
            alt={artifact.filename}
            className="block h-auto w-full"
            onLoad={(event) =>
              setDimensions(
                `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`
              )
            }
            src={imagePreviewUrl}
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center">
            <Image01Icon aria-hidden className="size-6 text-muted-foreground" />
          </div>
        )}
        <button
          aria-label={`View ${artifact.filename}`}
          className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          onClick={onOpen}
          type="button"
        />
        <div className="absolute top-3 right-3 flex gap-2">
          <a
            aria-label="Download image"
            className={IMAGE_ACTION_CLASS}
            download={artifact.filename}
            href={downloadUrl}
            rel="noopener"
          >
            <Download04Icon aria-hidden className="size-4" />
          </a>
          <button
            aria-label="Open full size"
            className={IMAGE_ACTION_CLASS}
            onClick={onOpen}
            type="button"
          >
            <ArrowExpand01Icon aria-hidden className="size-4" />
          </button>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-2">
        <span className={cn(IMAGE_META_CLASS, "max-w-full truncate")}>
          {artifact.filename}
        </span>
        {dimensions ? (
          <span className={IMAGE_META_CLASS}>{dimensions}</span>
        ) : null}
        {artifact.sizeBytes > 0 ? (
          <span className={IMAGE_META_CLASS}>
            {formatBytes(artifact.sizeBytes)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
