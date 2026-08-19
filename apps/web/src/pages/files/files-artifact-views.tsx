import type { ArtifactFile } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { formatError } from "@/lib/client";
import type { FilesViewMode } from "@/lib/files-page.shared";
import type { ArtifactFolderEntry } from "@/pages/files/files-artifact-folders";
import { ArtifactGridSkeleton } from "@/pages/files/files-artifact-grid-skeleton";
import { ArtifactGridView } from "@/pages/files/files-artifact-grid-view";
import { ArtifactListSkeleton } from "@/pages/files/files-artifact-list-skeleton";
import { ArtifactListView } from "@/pages/files/files-artifact-list-view";

function ShowMoreArtifactsButton({
  hasMore,
  isLoadingMore,
  onShowMore,
  remainingCount,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  onShowMore: () => void;
  remainingCount: number;
}) {
  if (!hasMore || remainingCount <= 0) {
    return null;
  }

  return (
    <div className="border-border border-t bg-muted/20 px-4 py-3 text-center">
      <Button
        disabled={isLoadingMore}
        onClick={onShowMore}
        size="sm"
        type="button"
        variant="outline"
      >
        {isLoadingMore ? (
          "Loading…"
        ) : (
          <>
            Show more
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums">{remainingCount}</span> remaining
          </>
        )}
      </Button>
    </div>
  );
}

export function FilesArtifactViews({
  viewMode,
  isLoading,
  isLoadingMore,
  error,
  artifacts,
  folders,
  listingFiles,
  emptyFilterMessage,
  showFullPath,
  profileId,
  deletePending,
  hasMore,
  remainingCount,
  onDelete,
  onOpenFolder,
  onShowMore,
}: {
  viewMode: FilesViewMode;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: unknown;
  artifacts: ArtifactFile[];
  folders: ArtifactFolderEntry[];
  listingFiles: ArtifactFile[];
  emptyFilterMessage: string;
  showFullPath: boolean;
  profileId: string;
  deletePending: boolean;
  hasMore: boolean;
  remainingCount: number;
  onDelete: (artifact: ArtifactFile) => void;
  onOpenFolder: (prefix: string) => void;
  onShowMore: () => void;
}) {
  const listingEmpty = folders.length === 0 && listingFiles.length === 0;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
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
      ) : listingEmpty ? (
        <div className="px-4 py-6 text-muted-foreground text-sm">
          {emptyFilterMessage}
        </div>
      ) : viewMode === "grid" ? (
        <div className="p-4">
          <ArtifactGridView
            artifacts={listingFiles}
            deletePending={deletePending}
            folders={folders}
            onDelete={onDelete}
            onOpenFolder={onOpenFolder}
            profileId={profileId}
            showFullPath={showFullPath}
          />
        </div>
      ) : (
        <ArtifactListView
          artifacts={listingFiles}
          deletePending={deletePending}
          folders={folders}
          onDelete={onDelete}
          onOpenFolder={onOpenFolder}
          profileId={profileId}
          showFullPath={showFullPath}
        />
      )}
      {isLoading || error || artifacts.length === 0 ? null : (
        <ShowMoreArtifactsButton
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onShowMore={onShowMore}
          remainingCount={remainingCount}
        />
      )}
    </div>
  );
}
