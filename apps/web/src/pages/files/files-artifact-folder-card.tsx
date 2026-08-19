import { Folder01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";
import {
  type ArtifactFolderEntry,
  artifactFolderFileLabel,
} from "@/pages/files/files-artifact-folders";
import { formatTimestamp } from "@/pages/files/files-shared";

export function ArtifactFolderCard({
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
          "flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-md border border-border bg-background text-left",
          "transition-colors duration-100 ease-out hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        )}
        onClick={() => onOpen(folder.prefix)}
        type="button"
      >
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden border-border border-b bg-muted/20">
          <Folder01Icon aria-hidden className="size-8 text-muted-foreground" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <p className="truncate font-medium text-foreground text-sm">
            {folder.name}
          </p>
          <p className="text-pretty text-muted-foreground text-xs">
            <span className="tabular-nums">
              {artifactFolderFileLabel(folder.fileCount)}
            </span>
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {formatTimestamp(folder.latestUpdatedAt)}
          </p>
        </div>
      </button>
    </li>
  );
}
