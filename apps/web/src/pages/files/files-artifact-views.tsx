import type { ArtifactFile } from "@nakama/core/contract";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  classifyArtifactType,
} from "@/components/soul-tools/artifacts-tab-filters";
import { formatError } from "@/lib/client";
import type { FilesViewMode } from "@/lib/files-page.shared";
import { formatBytes } from "@/lib/knowledge-base-files";
import {
  ArtifactIcon,
  ArtifactRowMenu,
  formatTimestamp,
  iconActionHitArea,
  toChatArtifactRef,
} from "@/pages/files/files-shared";

function ArtifactGridCard({
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
  const kind = classifyArtifactType(artifact);
  const typeLabel = ARTIFACT_TYPE_FILTER_LABELS[kind];
  const isImage = kind === "image";

  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="relative aspect-[4/3] overflow-hidden border-border border-b bg-muted/20">
        {isImage ? (
          <ArtifactAttachmentPreview
            artifact={toChatArtifactRef(artifact)}
            className="absolute inset-0 h-full w-full max-w-none gap-0 rounded-none border-0 bg-transparent p-0 hover:bg-transparent [&>div:first-child]:aspect-auto [&>div:first-child]:h-full [&>div:first-child]:rounded-none [&>div:first-child]:border-0 [&>div:last-child]:hidden [&_img]:aspect-auto [&_img]:h-full [&_img]:rounded-none [&_img]:border-0 [&_img]:outline-none"
            id={`files-page-grid:${artifact.path || artifact.filename}`}
            profileId={profileId}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ArtifactIcon
              className="mt-0 size-8"
              filename={artifact.filename}
              mimeType={artifact.mimeType}
            />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium text-foreground text-sm">
            {artifact.filename}
          </p>
          <p className="text-pretty text-muted-foreground text-xs">
            {typeLabel}
            {" · "}
            <span className="tabular-nums">
              {formatBytes(artifact.sizeBytes)}
            </span>
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {formatTimestamp(artifact.updatedAt)}
          </p>
        </div>
        <div className="mt-auto flex items-center justify-end gap-2">
          {isImage ? null : (
            <ArtifactAttachmentPreview
              artifact={toChatArtifactRef(artifact)}
              className={iconActionHitArea}
              id={`files-page-grid-view:${artifact.path || artifact.filename}`}
              profileId={profileId}
              variant="icon"
            />
          )}
          <ArtifactRowMenu
            artifact={artifact}
            deletePending={deletePending}
            onDelete={onDelete}
            profileId={profileId}
          />
        </div>
      </div>
    </li>
  );
}

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

export function ArtifactGridView({
  profileId,
  artifacts,
  deletePending,
  onDelete,
}: {
  profileId: string;
  artifacts: ArtifactFile[];
  deletePending: boolean;
  onDelete: (artifact: ArtifactFile) => void;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
      {artifacts.map((artifact) => (
        <ArtifactGridCard
          artifact={artifact}
          deletePending={deletePending}
          key={artifact.filename}
          onDelete={() => onDelete(artifact)}
          profileId={profileId}
        />
      ))}
    </ul>
  );
}

export function ArtifactListView({
  profileId,
  artifacts,
  deletePending,
  onDelete,
}: {
  profileId: string;
  artifacts: ArtifactFile[];
  deletePending: boolean;
  onDelete: (artifact: ArtifactFile) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {artifacts.map((artifact) => (
        <li
          className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-100 ease-out hover:bg-muted/40"
          key={artifact.filename}
        >
          <div className="flex min-w-0 items-start gap-3">
            <ArtifactIcon
              className="mt-0.5"
              filename={artifact.filename}
              mimeType={artifact.mimeType}
            />
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground text-sm">
                {artifact.filename}
              </p>
              <p className="text-pretty text-muted-foreground text-xs">
                {artifact.mimeType} ·{" "}
                <span className="tabular-nums">
                  {formatBytes(artifact.sizeBytes)}
                </span>
                {" · "}
                {formatTimestamp(artifact.updatedAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ArtifactAttachmentPreview
              artifact={toChatArtifactRef(artifact)}
              className={iconActionHitArea}
              id={`files-page:${artifact.path || artifact.filename}`}
              profileId={profileId}
              variant="icon"
            />
            <ArtifactRowMenu
              artifact={artifact}
              deletePending={deletePending}
              onDelete={() => onDelete(artifact)}
              profileId={profileId}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

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
