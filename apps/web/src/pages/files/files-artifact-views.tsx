import type { ArtifactFile } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useState } from "react";
import { formatError } from "@/lib/client";
import type { FilesViewMode } from "@/lib/files-page.shared";
import { ArtifactFolderCard } from "@/pages/files/files-artifact-folder-card";
import type { ArtifactFolderEntry } from "@/pages/files/files-artifact-folders";
import { ArtifactGridCard } from "@/pages/files/files-artifact-grid-card";
import {
  ArtifactListView,
  FileEntriesLayout,
} from "@/pages/files/files-artifact-list-view";

function ArtifactGridSkeleton() {
  return (
    <ul
      aria-hidden
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <li
          className="overflow-hidden rounded-xl border border-border bg-card"
          key={`artifact-grid-skeleton-${index}`}
        >
          <div className="skeleton-shimmer min-h-32 w-full" />
        </li>
      ))}
    </ul>
  );
}

function ArtifactListSkeleton() {
  return (
    <ul
      aria-hidden
      className="divide-y divide-border rounded-xl border border-border bg-card"
    >
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
  showFullPath,
  onOpenFolder,
}: {
  profileId: string;
  folders: ArtifactFolderEntry[];
  artifacts: ArtifactFile[];
  showFullPath: boolean;
  onOpenFolder: (prefix: string) => void;
}) {
  return (
    <FileEntriesLayout viewMode="grid">
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
          key={artifact.filename}
          profileId={profileId}
          showFullPath={showFullPath}
        />
      ))}
    </FileEntriesLayout>
  );
}

function FilesArtifactViewsBody({
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
  onDelete: (artifact: ArtifactFile) => void;
  onOpenFolder: (prefix: string) => void;
}) {
  if (isLoading) {
    if (viewMode === "grid") {
      return <ArtifactGridSkeleton />;
    }

    return <ArtifactListSkeleton />;
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

  if (folders.length === 0 && listingFiles.length === 0) {
    return (
      <div className="px-4 py-6 text-muted-foreground text-sm">
        {emptyFilterMessage}
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <ArtifactGridView
        artifacts={listingFiles}
        folders={folders}
        onOpenFolder={onOpenFolder}
        profileId={profileId}
        showFullPath={showFullPath}
      />
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
  onDelete: (artifact: ArtifactFile) => void;
  onOpenFolder: (prefix: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(30);
  const remainingCount = Math.max(
    folders.length + listingFiles.length - visibleCount,
    0
  );
  return (
    <div className="space-y-4">
      <FilesArtifactViewsBody
        artifacts={artifacts}
        deletePending={deletePending}
        emptyFilterMessage={emptyFilterMessage}
        error={error}
        folders={folders.slice(0, visibleCount)}
        isLoading={isLoading}
        listingFiles={listingFiles.slice(
          0,
          Math.max(visibleCount - folders.length, 0)
        )}
        onDelete={onDelete}
        onOpenFolder={onOpenFolder}
        profileId={profileId}
        showFullPath={showFullPath}
        viewMode={viewMode}
      />
      {!(isLoading || error) && remainingCount > 0 ? (
        <div className="text-center">
          <Button
            onClick={() => setVisibleCount((count) => count + 30)}
            size="sm"
            type="button"
            variant="outline"
          >
            Show more · {remainingCount} remaining
          </Button>
        </div>
      ) : null}
    </div>
  );
}
