import type { ArtifactFile } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Folder01Icon, PinIcon, PinOffIcon } from "hugeicons-react";
import { type ReactNode, useContext } from "react";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import type { FilesViewMode } from "@/lib/files-page.shared";
import { formatBytes } from "@/lib/knowledge-base-files";
import {
  type ArtifactFolderEntry,
  artifactBasename,
} from "@/pages/files/files-artifact-folders";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import {
  ArtifactRowMenu,
  FileRenameMenu,
} from "@/pages/files/files-artifact-row-menu";
import { FilePinsContext, toChatArtifactRef } from "@/pages/files/files-shared";

export function FileEntriesLayout({
  viewMode,
  children,
}: {
  viewMode: FilesViewMode;
  children: ReactNode;
}) {
  if (viewMode === "grid") {
    return (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] items-start gap-3">
        {children}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-2">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="rounded-l-lg px-3 py-2.5 font-normal" scope="col">
              Name
            </th>
            <th
              className="hidden w-28 px-3 py-2.5 font-normal md:table-cell"
              scope="col"
            >
              Type
            </th>
            <th
              className="hidden w-24 px-3 py-2.5 font-normal sm:table-cell"
              scope="col"
            >
              Size
            </th>
            <th
              className="hidden w-36 px-3 py-2.5 font-normal lg:table-cell"
              scope="col"
            >
              Modified
            </th>
            <th className="w-24 rounded-r-lg" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  );
}

export function FileEntry({
  filename,
  mimeType = "",
  sizeBytes = 0,
  updatedAt = "",
  directory = false,
  viewMode,
  onOpen,
  actions,
  pinPath,
}: {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  updatedAt?: string;
  directory?: boolean;
  viewMode: FilesViewMode;
  onOpen: () => void;
  actions?: ReactNode;
  pinPath?: string;
}) {
  const controls =
    actions || pinPath ? (
      <FileEntryActions
        actions={actions}
        filename={filename}
        pinPath={pinPath}
        viewMode={viewMode}
      />
    ) : null;
  const date = new Date(updatedAt);
  const modified = Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
  const type = directory
    ? "Folder"
    : artifactBasename(filename).split(".").slice(1).pop()?.toUpperCase() ||
      "File";
  const icon = directory ? (
    <Folder01Icon
      aria-hidden
      className={
        viewMode === "grid"
          ? "size-10 fill-muted-foreground/10 text-muted-foreground"
          : "size-5 text-muted-foreground"
      }
    />
  ) : (
    <ArtifactIcon className="size-5" filename={filename} mimeType={mimeType} />
  );
  if (viewMode === "list") {
    return (
      <tr className="group/file hover:bg-muted/30">
        <td className="p-0">
          <button
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOpen}
            title={filename}
            type="button"
          >
            <span className="shrink-0">{icon}</span>
            <span
              className="min-w-0 truncate font-medium data-[directory=true]:line-clamp-3 data-[directory=true]:whitespace-normal data-[directory=true]:break-all"
              data-directory={directory}
            >
              {filename}
            </span>
          </button>
        </td>
        <td className="hidden truncate px-3 py-3 text-muted-foreground md:table-cell">
          {type}
        </td>
        <td className="hidden px-3 py-3 text-muted-foreground tabular-nums sm:table-cell">
          {directory ? "—" : formatBytes(sizeBytes)}
        </td>
        <td className="hidden px-3 py-3 text-muted-foreground tabular-nums lg:table-cell">
          {modified}
        </td>
        <td className="px-2">{controls}</td>
      </tr>
    );
  }
  return (
    <GridFileEntry
      actions={actions}
      controls={controls}
      directory={directory}
      filename={filename}
      icon={icon}
      modified={modified}
      onOpen={onOpen}
    />
  );
}

function GridFileEntry({
  actions,
  controls,
  directory,
  filename,
  icon,
  modified,
  onOpen,
}: {
  actions: ReactNode;
  controls: ReactNode;
  directory: boolean;
  filename: string;
  icon: ReactNode;
  modified: string;
  onOpen: () => void;
}) {
  return (
    <li className="group/file relative min-w-0 rounded-xl border border-border bg-card transition-colors hover:border-foreground/20">
      <button
        className={`flex w-full gap-3 rounded-xl p-4 text-left hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${directory ? "min-h-36 flex-col items-start" : actions ? "min-h-24 items-center" : "min-h-20 items-center"} ${controls ? "pr-12" : ""}`}
        onClick={onOpen}
        title={filename}
        type="button"
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-lg bg-muted/60 ${directory ? "mb-1 h-12 w-16" : "size-11"}`}
        >
          {icon}
        </span>
        <span className="min-w-0 max-w-full space-y-1">
          <span
            className={`font-medium text-sm ${directory ? "line-clamp-3 break-all" : "block truncate"}`}
          >
            {filename}
          </span>
          {directory ? null : (
            <span className="block text-muted-foreground text-xs tabular-nums">
              {modified}
            </span>
          )}
        </span>
      </button>
      {controls ? (
        <div className="absolute top-3 right-3">{controls}</div>
      ) : null}
    </li>
  );
}

function ArtifactListFile({
  artifact,
  profileId,
  deletePending,
  onDelete,
  showFullPath,
}: {
  artifact: ArtifactFile;
  profileId: string;
  deletePending: boolean;
  onDelete: () => void;
  showFullPath: boolean;
}) {
  const { openPanel } = useArtifactAttachmentPreviewPanel({
    artifact: toChatArtifactRef(artifact),
    id: `files-page:${artifact.path || artifact.filename}`,
    profileId,
  });
  return (
    <FileEntry
      {...artifact}
      actions={
        <ArtifactRowMenu
          artifact={artifact}
          deletePending={deletePending}
          onDelete={onDelete}
          profileId={profileId}
        />
      }
      filename={
        showFullPath ? artifact.filename : artifactBasename(artifact.filename)
      }
      onOpen={openPanel}
      pinPath={`artifacts/${artifact.filename}`}
      viewMode="list"
    />
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
    <FileEntriesLayout viewMode="list">
      {folders.map((folder) => (
        <FileEntry
          directory
          filename={folder.name}
          key={folder.prefix}
          onOpen={() => onOpenFolder(folder.prefix)}
          pinPath={`artifacts/${folder.prefix}`}
          updatedAt={folder.latestUpdatedAt}
          viewMode="list"
        />
      ))}
      {artifacts.map((artifact) => (
        <ArtifactListFile
          artifact={artifact}
          deletePending={deletePending}
          key={artifact.filename}
          onDelete={() => onDelete(artifact)}
          profileId={profileId}
          showFullPath={showFullPath}
        />
      ))}
    </FileEntriesLayout>
  );
}

function FilePinButton({
  filename,
  path,
  pins,
}: {
  filename: string;
  path: string;
  pins: NonNullable<React.ContextType<typeof FilePinsContext>>;
}) {
  const pinned = pins.paths.has(path);
  return (
    <Button
      aria-label={`${pinned ? "Unpin" : "Pin"} ${filename}`}
      aria-pressed={pinned}
      className="size-9 opacity-0 group-focus-within/file:opacity-100 group-hover/file:opacity-100 [@media(hover:none)]:opacity-100"
      disabled={pins.pending}
      onClick={() => pins.toggle(path, !pinned)}
      size="icon-sm"
      title={pinned ? "Unpin" : "Pin"}
      type="button"
      variant={pinned ? "secondary" : "ghost"}
    >
      {pinned ? (
        <PinOffIcon aria-hidden className="size-4" />
      ) : (
        <PinIcon aria-hidden className="size-4" />
      )}
    </Button>
  );
}

function FileEntryActions({
  actions,
  filename,
  pinPath,
  viewMode,
}: {
  actions: ReactNode;
  filename: string;
  pinPath?: string;
  viewMode: FilesViewMode;
}) {
  const pins = useContext(FilePinsContext);
  const entryActions =
    actions ??
    (pinPath && <FileRenameMenu filename={filename} path={pinPath} />);
  const pinAction =
    pinPath && pins ? (
      <FilePinButton filename={filename} path={pinPath} pins={pins} />
    ) : null;
  return entryActions || pinAction ? (
    <div
      className={`flex gap-2 ${viewMode === "grid" ? "flex-col" : "items-center justify-end"}`}
    >
      {pinAction}
      {entryActions}
    </div>
  ) : null;
}
