import type { ArtifactFile } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { ArrowRight01Icon, Folder01Icon } from "hugeicons-react";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import { formatBytes } from "@/lib/knowledge-base-files";
import {
  type ArtifactFolderEntry,
  artifactBasename,
  artifactFolderFileLabel,
} from "@/pages/files/files-artifact-folders";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import { ArtifactRowMenu } from "@/pages/files/files-artifact-row-menu";
import { formatTimestamp, toChatArtifactRef } from "@/pages/files/files-shared";

function ArtifactFolderRow({
  folder,
  onOpen,
}: {
  folder: ArtifactFolderEntry;
  onOpen: (prefix: string) => void;
}) {
  return (
    <li>
      <button
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-100 ease-out",
          "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        )}
        onClick={() => onOpen(folder.prefix)}
        type="button"
      >
        <div className="flex min-w-0 items-start gap-3">
          <Folder01Icon
            aria-hidden
            className="mt-0.5 size-4 text-muted-foreground"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground text-sm">
              {folder.name}
            </p>
            <p className="text-pretty text-muted-foreground text-xs">
              <span className="tabular-nums">
                {artifactFolderFileLabel(folder.fileCount)}
              </span>
              {" · "}
              {formatTimestamp(folder.latestUpdatedAt)}
            </p>
          </div>
        </div>
        <ArrowRight01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>
    </li>
  );
}

export function ArtifactListView({
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
    <ul className="divide-y divide-border">
      {folders.map((folder) => (
        <ArtifactFolderRow
          folder={folder}
          key={folder.prefix}
          onOpen={onOpenFolder}
        />
      ))}
      {artifacts.map((artifact) => (
        <li
          className="relative flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-100 ease-out hover:bg-muted/40"
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
                {showFullPath
                  ? artifact.filename
                  : artifactBasename(artifact.filename)}
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
          <ArtifactAttachmentPreview
            artifact={toChatArtifactRef(artifact)}
            id={`files-page:${artifact.path || artifact.filename}`}
            profileId={profileId}
            variant="overlay"
          />
          <div className="relative z-10 shrink-0">
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
