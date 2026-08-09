import type { ArtifactFile } from "@nakama/core/contract";
import {
  Delete02Icon,
  File02Icon,
  FileDownloadIcon,
  Film02Icon,
  Image02Icon,
  MoreHorizontalIcon,
} from "hugeicons-react";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
import { classifyArtifactType } from "@/components/soul-tools/artifacts-tab-filters";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { cn } from "@/lib/utils";

/** Extend icon-sm (28px) to a 40px hit target without overlapping neighbors at gap-3. */
export const iconActionHitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

export function toChatArtifactRef(artifact: ArtifactFile): ChatArtifactRef {
  return {
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    path: artifact.path || artifact.filename,
    savedAt: artifact.updatedAt,
    sizeBytes: artifact.sizeBytes,
  };
}

const artifactTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTimestamp(value: string): string {
  try {
    return artifactTimestampFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

export function getArtifactDownloadUrl(
  profileId: string,
  filename: string
): string {
  const query = new URLSearchParams({ path: filename });
  return `${client.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`;
}

export function ArtifactIcon({
  mimeType,
  filename,
  className,
}: {
  mimeType: string;
  filename: string;
  className?: string;
}) {
  const kind = classifyArtifactType({
    filename,
    mimeType,
    path: filename,
    sizeBytes: 0,
    updatedAt: "",
  });
  const iconClass = cn("size-4 text-muted-foreground", className);

  if (kind === "image") {
    return <Image02Icon aria-hidden className={iconClass} />;
  }

  if (kind === "video") {
    return <Film02Icon aria-hidden className={iconClass} />;
  }

  return <File02Icon aria-hidden className={iconClass} />;
}

export function ArtifactRowMenu({
  profileId,
  artifact,
  deletePending,
  onDelete,
}: {
  profileId: string;
  artifact: ArtifactFile;
  deletePending: boolean;
  onDelete: () => void;
}) {
  const artifactPath = artifact.path || artifact.filename;
  const share = useArtifactShareControls({ artifactPath, profileId });
  const downloadUrl = getArtifactDownloadUrl(profileId, artifactPath);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Artifact actions"
              className={iconActionHitArea}
              size="icon-sm"
              type="button"
              variant="outline"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <ArtifactShareMenuItem share={share} />
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
            <FileDownloadIcon aria-hidden />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={deletePending}
            onClick={onDelete}
            variant="destructive"
          >
            <Delete02Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArtifactSharePublishDialogFromState
        artifactPath={artifactPath}
        share={share}
      />
    </>
  );
}
