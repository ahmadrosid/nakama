import type { ArtifactFile } from "@nakama/core/contract";
import { formatError } from "@/lib/client";
import type { FilesViewMode } from "@/lib/files-page.shared";
import { ArtifactGridSkeleton } from "@/pages/files/files-artifact-grid-skeleton";
import { ArtifactGridView } from "@/pages/files/files-artifact-grid-view";
import { ArtifactListSkeleton } from "@/pages/files/files-artifact-list-skeleton";
import { ArtifactListView } from "@/pages/files/files-artifact-list-view";

export function FilesArtifactViews({
  viewMode,
  isLoading,
  error,
  artifacts,
  filteredArtifacts,
  emptyFilterMessage,
  profileId,
  deletePending,
  onDelete,
}: {
  viewMode: FilesViewMode;
  isLoading: boolean;
  error: unknown;
  artifacts: ArtifactFile[];
  filteredArtifacts: ArtifactFile[];
  emptyFilterMessage: string;
  profileId: string;
  deletePending: boolean;
  onDelete: (artifact: ArtifactFile) => void;
}) {
  if (
    viewMode === "grid" &&
    !isLoading &&
    !error &&
    filteredArtifacts.length > 0
  ) {
    return (
      <ArtifactGridView
        artifacts={filteredArtifacts}
        deletePending={deletePending}
        onDelete={onDelete}
        profileId={profileId}
      />
    );
  }

  return (
    <div className="rounded-md border border-border">
      {isLoading ? (
        viewMode === "grid" ? (
          <ArtifactGridSkeleton />
        ) : (
          <ArtifactListSkeleton />
        )
      ) : error ? (
        <div className="px-4 py-6 text-destructive text-sm">
          {formatError(error)}
        </div>
      ) : artifacts.length === 0 ? (
        <div className="px-4 py-10 text-center text-muted-foreground text-sm">
          No artifacts yet.
        </div>
      ) : filteredArtifacts.length === 0 ? (
        <div className="px-4 py-6 text-muted-foreground text-sm">
          {emptyFilterMessage}
        </div>
      ) : (
        <ArtifactListView
          artifacts={filteredArtifacts}
          deletePending={deletePending}
          onDelete={onDelete}
          profileId={profileId}
        />
      )}
    </div>
  );
}
