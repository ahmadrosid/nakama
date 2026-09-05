import type { ArtifactFile } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { formatError } from "@/lib/client";
import type { FilesViewMode } from "@/lib/files-page.shared";
import { ArtifactFolderCard } from "@/pages/files/files-artifact-folder-card";
import type { ArtifactFolderEntry } from "@/pages/files/files-artifact-folders";
import { ArtifactGridCard } from "@/pages/files/files-artifact-grid-card";
import { ArtifactListView } from "@/pages/files/files-artifact-list-view";

type FilesArtifactPagination = {
  loadingMore: boolean;
  onShowMore: () => void;
  remainingCount: number;
};

function ArtifactGridSkeleton() {
  return (
    <ul
      aria-hidden
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 p-3"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <li
          className="overflow-hidden rounded-md border border-border"
          key={`artifact-grid-skeleton-${index}`}
        >
          <div className="skeleton-shimmer aspect-[4/3] w-full" />
          <div className="space-y-2 p-3">
            <div className="skeleton-shimmer h-4 w-3/4 rounded" />
            <div className="skeleton-shimmer h-3 w-1/2 rounded" />
            <div className="skeleton-shimmer h-3 w-2/3 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ArtifactListSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, index) => (
        <li
          className="flex items-center justify-between gap-3 px-4 py-3"
          key={`artifact-skeleton-${index}`}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="skeleton-shimmer mt-0.5 size-4 shrink-0 rounded" />
            <div className="min-w-0 space-y-1.5">
              <div className="skeleton-shimmer h-4 w-48 max-w-full rounded" />
              <div className="skeleton-shimmer h-3 w-64 max-w-full rounded" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="skeleton-shimmer size-8 rounded-md" />
            <div className="skeleton-shimmer size-8 rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ArtifactGridView({
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
      {isLoading || error || artifacts.length === 0 || !pagination ? null : (
        <ShowMoreArtifactsButton
          loadingMore={pagination.loadingMore}
          onShowMore={pagination.onShowMore}
          remainingCount={pagination.remainingCount}
        />
      )}
    </div>
  );
}
