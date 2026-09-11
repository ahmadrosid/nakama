import type { ArtifactFile } from "@nakama/core/contract";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  classifyArtifactType,
} from "@/components/soul-tools/artifacts-tab-filters";
import { formatBytes } from "@/lib/knowledge-base-files";
import { artifactBasename } from "@/pages/files/files-artifact-folders";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import { ArtifactRowMenu } from "@/pages/files/files-artifact-row-menu";
import { formatTimestamp, toChatArtifactRef } from "@/pages/files/files-shared";

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
  const { imagePreviewUrl, openPanel } = useArtifactAttachmentPreviewPanel({
    artifact: toChatArtifactRef(artifact),
    id: `files-page-grid:${artifact.path || artifact.filename}`,
    profileId,
  });

  return (
    <li className="relative flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background transition-colors hover:bg-muted/40">
      <div className="relative aspect-[4/3] overflow-hidden border-border border-b bg-muted/20">
        {kind === "image" && imagePreviewUrl ? (
          <img
            alt=""
            className="h-full w-full object-cover"
            src={imagePreviewUrl}
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
        <button
          aria-label={`View ${artifact.filename}`}
          className="absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          onClick={openPanel}
          type="button"
        />
        <div className="relative z-10 mt-auto flex self-end">
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
