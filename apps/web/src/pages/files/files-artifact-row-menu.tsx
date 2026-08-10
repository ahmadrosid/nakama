import type { ArtifactFile } from "@nakama/core/contract";
import {
  Delete02Icon,
  FileDownloadIcon,
  MoreHorizontalIcon,
} from "hugeicons-react";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getArtifactDownloadUrl,
  iconActionHitArea,
} from "@/pages/files/files-shared";

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
