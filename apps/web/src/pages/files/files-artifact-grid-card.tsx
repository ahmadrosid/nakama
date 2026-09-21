import type { ArtifactFile } from "@nakama/core/contract";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import { artifactBasename } from "@/pages/files/files-artifact-folders";
import { FileEntry } from "@/pages/files/files-artifact-list-view";
import { toChatArtifactRef } from "@/pages/files/files-shared";

export function ArtifactGridCard({
  profileId,
  artifact,
  showFullPath,
}: {
  profileId: string;
  artifact: ArtifactFile;
  showFullPath: boolean;
}) {
  const { openPanel } = useArtifactAttachmentPreviewPanel({
    artifact: toChatArtifactRef(artifact),
    id: `files-page-grid:${artifact.path || artifact.filename}`,
    profileId,
  });

  return (
    <FileEntry
      {...artifact}
      filename={
        showFullPath ? artifact.filename : artifactBasename(artifact.filename)
      }
      onOpen={openPanel}
      pinPath={`artifacts/${artifact.filename}`}
      viewMode="grid"
    />
  );
}
