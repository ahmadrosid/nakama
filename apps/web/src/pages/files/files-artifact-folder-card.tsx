import { Folder01Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
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
  const openFolder = () => onOpen(folder.prefix);

  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <button
        className="relative flex aspect-[4/3] w-full cursor-pointer items-center justify-center overflow-hidden border-border border-b bg-muted/20 transition-colors duration-100 ease-out hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={openFolder}
        type="button"
      >
        <Folder01Icon aria-hidden className="size-8 text-muted-foreground" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium text-foreground text-sm">
            {folder.name}
          </p>
          <p className="text-pretty text-muted-foreground text-xs">
            Folder
            {" · "}
            <span className="tabular-nums">
              {artifactFolderFileLabel(folder.fileCount)}
            </span>
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {formatTimestamp(folder.latestUpdatedAt)}
          </p>
        </div>
        <div className="mt-auto flex items-center justify-end gap-2">
          <Button
            onClick={openFolder}
            size="sm"
            type="button"
            variant="outline"
          >
            Open
          </Button>
        </div>
      </div>
    </li>
  );
}
