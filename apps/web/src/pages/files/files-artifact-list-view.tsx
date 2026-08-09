import type { ArtifactFile } from "@nakama/core/contract";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import { formatBytes } from "@/lib/knowledge-base-files";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import { ArtifactRowMenu } from "@/pages/files/files-artifact-row-menu";
import {
  formatTimestamp,
  iconActionHitArea,
  toChatArtifactRef,
} from "@/pages/files/files-shared";

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
