import type { ArtifactFile } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { formatError } from "@/lib/client";
import type { FilesViewMode } from "@/lib/files-page.shared";
import type { ArtifactFolderEntry } from "@/pages/files/files-artifact-folders";
import { ArtifactGridSkeleton } from "@/pages/files/files-artifact-grid-skeleton";
import { ArtifactGridView } from "@/pages/files/files-artifact-grid-view";
import { ArtifactListSkeleton } from "@/pages/files/files-artifact-list-skeleton";
import { ArtifactListView } from "@/pages/files/files-artifact-list-view";

type FilesArtifactPagination = {
  loadingMore: boolean;
  onShowMore: () => void;
  remainingCount: number;
};

function ShowMoreArtifactsButton({
  loadingMore,
  onShowMore,
  remainingCount,
}: FilesArtifactPagination) {
  if (remainingCount <= 0) {
    return null;
  }

  return (
    <div className="border-border border-t bg-muted/20 px-4 py-3 text-center">
      <Button
        disabled={loadingMore}
        onClick={onShowMore}
        size="sm"
        type="button"
        variant="outline"
      >
        {loadingMore ? (
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
  error,
  artifacts,
  folders,
  listingFiles,
  emptyFilterMessage,
  showFullPath,
  profileId,
  deletePending,
  pagination,
  onDelete,
  onOpenFolder,
}: {
  viewMode: FilesViewMode;
  isLoading: boolean;
  error: unknown;
  artifacts: ArtifactFile[];
  folders: ArtifactFolderEntry[];
  listingFiles: ArtifactFile[];
  emptyFilterMessage: string;
  showFullPath: boolean;
  profileId: string;
  deletePending: boolean;
  pagination: FilesArtifactPagination | null;
  onDelete: (artifact: ArtifactFile) => void;
  onOpenFolder: (prefix: string) => void;
}) {
  const listingEmpty = folders.length === 0 && listingFiles.length === 0;
  const showPagination = !(
    isLoading ||
    error ||
    artifacts.length === 0 ||
    !pagination
  );

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <FilesArtifactViewsBody
        artifacts={artifacts}
        deletePending={deletePending}
        emptyFilterMessage={emptyFilterMessage}
        error={error}
        folders={folders}
        isLoading={isLoading}
        listingEmpty={listingEmpty}
        listingFiles={listingFiles}
        onDelete={onDelete}
        onOpenFolder={onOpenFolder}
        profileId={profileId}
        showFullPath={showFullPath}
        viewMode={viewMode}
      />
      {showPagination && pagination ? (
        <ShowMoreArtifactsButton
          loadingMore={pagination.loadingMore}
          onShowMore={pagination.onShowMore}
          remainingCount={pagination.remainingCount}
        />
      ) : null}
    </div>
  );
}

function FilesArtifactViewsBody({
  viewMode,
  isLoading,
  error,
  artifacts,
  folders,
  listingFiles,
  listingEmpty,
  emptyFilterMessage,
  showFullPath,
  profileId,
  deletePending,
  onDelete,
  onOpenFolder,
}: {
  viewMode: FilesViewMode;
  isLoading: boolean;
  error: unknown;
  artifacts: ArtifactFile[];
  folders: ArtifactFolderEntry[];
  listingFiles: ArtifactFile[];
  listingEmpty: boolean;
  emptyFilterMessage: string;
  showFullPath: boolean;
  profileId: string;
  deletePending: boolean;
  onDelete: (artifact: ArtifactFile) => void;
  onOpenFolder: (prefix: string) => void;
}) {
  if (isLoading) {
    return viewMode === "grid" ? (
      <ArtifactGridSkeleton />
    ) : (
      <ArtifactListSkeleton />
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6 text-destructive text-sm">
        {formatError(error)}
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-muted-foreground text-sm">
        No artifacts yet.
      </div>
    );
  }

  if (listingEmpty) {
    return (
      <div className="px-4 py-6 text-muted-foreground text-sm">
        {emptyFilterMessage}
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
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
    );
  }

  return (
    <ArtifactListView
      artifacts={listingFiles}
      deletePending={deletePending}
      folders={folders}
      onDelete={onDelete}
      onOpenFolder={onOpenFolder}
      profileId={profileId}
      showFullPath={showFullPath}
    />
  );
}
