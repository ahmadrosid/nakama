import type { ArtifactFile } from "@nakama/core/contract";
import { ArtifactFolderCard } from "@/pages/files/files-artifact-folder-card";
import type { ArtifactFolderEntry } from "@/pages/files/files-artifact-folders";
import { ArtifactGridCard } from "@/pages/files/files-artifact-grid-card";

export function ArtifactGridView({
  profileId,
  folders,
  artifacts,
  deletePending,
  showFullPath,
  onDelete,
  onOpenFolder,
}: {
  profileId: string;
  folders: ArtifactFolderEntry[];
  artifacts: ArtifactFile[];
  deletePending: boolean;
  showFullPath: boolean;
  onDelete: (artifact: ArtifactFile) => void;
  onOpenFolder: (prefix: string) => void;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
      {folders.map((folder) => (
        <ArtifactFolderCard
          folder={folder}
          key={folder.prefix}
          onOpen={onOpenFolder}
        />
      ))}
      {artifacts.map((artifact) => (
        <ArtifactGridCard
          artifact={artifact}
          deletePending={deletePending}
          key={artifact.filename}
          onDelete={() => onDelete(artifact)}
          profileId={profileId}
          showFullPath={showFullPath}
        />
      ))}
    </ul>
  );
}
