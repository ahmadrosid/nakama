import type { ArtifactFile } from "@nakama/core/contract";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  classifyArtifactType,
} from "@/components/soul-tools/artifacts-tab-filters";
import { formatBytes } from "@/lib/knowledge-base-files";
import { artifactBasename } from "@/pages/files/files-artifact-folders";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import { ArtifactRowMenu } from "@/pages/files/files-artifact-row-menu";
import {
  formatTimestamp,
  iconActionHitArea,
  toChatArtifactRef,
} from "@/pages/files/files-shared";

export function ArtifactGridCard({
  profileId,
  artifact,
  deletePending,
  showFullPath,
  onDelete,
}: {
  profileId: string;
  artifact: ArtifactFile;
  deletePending: boolean;
  showFullPath: boolean;
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
            {showFullPath
              ? artifact.filename
              : artifactBasename(artifact.filename)}
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
