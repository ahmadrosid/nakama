import type { ArtifactFile, WorkspaceEntry } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Download04Icon } from "hugeicons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArtifactAttachmentPanelActions } from "@/components/chat/artifact-attachment-panel-actions";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelHeaderMeta,
  downloadActionLabel,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import {
  type ArtifactPreviewMode,
  ArtifactPreviewModeToggle,
} from "@/components/chat/artifact-preview-mode-toggle";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  type ArtifactTypeFilter,
  artifactMatchesTypeFilter,
  availableArtifactTypeFilters,
} from "@/components/soul-tools/artifacts-tab-filters";
import { KnowledgeTab } from "@/components/soul-tools/KnowledgeTab";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useArtifactsQuery,
  useDeleteArtifactMutation,
  useFilePins,
} from "@/hooks/use-resource-mutations";
import {
  artifactCodeLanguage,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import {
  type FilesViewMode,
  getStoredFilesViewMode,
  resolveFilesProfileId,
  setStoredFilesViewMode,
} from "@/lib/files-page.shared";
import { formatBytes } from "@/lib/knowledge-base-files";
import { ArtifactFolderBreadcrumb } from "@/pages/files/files-artifact-folder-breadcrumb";
import {
  artifactBasename,
  listArtifactsInFolder,
  normalizeArtifactFolderPrefix,
} from "@/pages/files/files-artifact-folders";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import {
  FileEntriesLayout,
  FileEntry,
} from "@/pages/files/files-artifact-list-view";
import { FilesArtifactViews } from "@/pages/files/files-artifact-views";
import {
  FilesDeleteDialog,
  FilesRename,
} from "@/pages/files/files-delete-dialog";
import { FilesSearchRow } from "@/pages/files/files-search-row";
import { FilePinsContext, toChatArtifactRef } from "@/pages/files/files-shared";
import { FilesToolbar } from "@/pages/files/files-toolbar";

const EMPTY_ARTIFACTS: ArtifactFile[] = [];

export function FilesPage() {
  const { profileId: activeProfileId } = useActiveChatProfile();
  const { data: profiles = [] } = useProfilesQuery();
  const profileId = resolveFilesProfileId({ activeProfileId, profiles });
  const { user, activeOrg } = useAuth();
  const canViewFiles = user?.isPlatformAdmin === true;
  const pins = useFilePins(profileId, canViewFiles);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") ?? "workspace";
  function navigate(view: string, folder = "") {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", view);
      next.delete("folder");
      if (folder) {
        next.set("folder", folder);
      }
      return next;
    });
  }

  return (
    <FilesRename
      key={`${activeOrg?.id}:${profileId}`}
      onRenamed={(oldPath, newPath) => {
        const folder = searchParams.get("folder") ?? "";
        const prefix = view === "artifacts" ? "artifacts/" : "";
        const currentPath = `${prefix}${folder}`.replace(/\/$/, "");
        if (currentPath === oldPath || currentPath.startsWith(`${oldPath}/`)) {
          navigate(
            view,
            `${newPath}${currentPath.slice(oldPath.length)}`.slice(
              prefix.length
            )
          );
        }
      }}
      profileId={canViewFiles ? profileId : null}
    >
      <ChatAttachmentPanelProvider
        key={`${activeOrg?.id}:${profileId}`}
        presentation="overlay"
      >
        <FilePinsContext.Provider value={pins.controls}>
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
            {canViewFiles ? (
              <div className="space-y-4">
                <nav
                  aria-label="File locations"
                  className="flex flex-wrap gap-2"
                >
                  {(["workspace", "artifacts", "knowledge"] as const).map(
                    (location) => (
                      <Button
                        aria-current={view === location ? "page" : undefined}
                        key={location}
                        onClick={() => navigate(location)}
                        variant={view === location ? "secondary" : "ghost"}
                      >
                        {location === "workspace"
                          ? "All files"
                          : location === "artifacts"
                            ? "Artifacts"
                            : "Knowledge"}
                      </Button>
                    )
                  )}
                </nav>
                {view === "knowledge" ? null : (
                  <PinnedFilesSection
                    entries={pins.entries}
                    error={pins.error}
                    key={`${activeOrg?.id}:${profileId}`}
                    onOpenFolder={(folder) => navigate("workspace", folder)}
                    profileId={profileId}
                  />
                )}
                {view === "knowledge" ? (
                  <KnowledgeTab key={profileId} profileId={profileId} />
                ) : view === "artifacts" ? (
                  <FilesArtifactsPage key={profileId} profileId={profileId} />
                ) : (
                  <WorkspaceFilesPage
                    folder={searchParams.get("folder") ?? ""}
                    key={`${profileId}:${searchParams.get("folder") ?? ""}`}
                    onNavigate={(folder) => navigate("workspace", folder)}
                    profileId={profileId}
                  />
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Workspace files are available to platform administrators.
              </p>
            )}
          </div>
        </FilePinsContext.Provider>
      </ChatAttachmentPanelProvider>
    </FilesRename>
  );
}

function PinnedFilesSection({
  entries,
  profileId,
  error,
  onOpenFolder,
}: {
  entries: WorkspaceEntry[];
  profileId: string | null;
  error: unknown;
  onOpenFolder: (folder: string) => void;
}) {
  const [selected, setSelected] = useState<WorkspaceEntry | null>(null);
  const closePreview = useCallback(() => setSelected(null), []);
  if (!profileId) {
    return null;
  }
  return (
    <>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(error)}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <section aria-label="Pinned files" className="space-y-3">
          <h2 className="font-medium text-sm">Pinned</h2>
          <FileEntriesLayout viewMode="grid">
            {entries.map((entry) => (
              <FileEntry
                {...entry}
                directory={entry.kind === "directory"}
                key={entry.path}
                onOpen={() => {
                  setSelected(null);
                  if (entry.kind === "directory") {
                    onOpenFolder(entry.path);
                  } else {
                    setSelected(entry);
                  }
                }}
                pinPath={entry.path}
                viewMode="grid"
              />
            ))}
          </FileEntriesLayout>
          {selected ? (
            <WorkspaceFilePreview
              entry={selected}
              id={`pinned:${profileId}:${selected.path}`}
              key={selected.path}
              onClose={closePreview}
              profileId={profileId}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function FilesArtifactsPage({ profileId }: { profileId: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderPrefix = normalizeArtifactFolderPrefix(
    searchParams.get("folder") ?? ""
  );

  const [deleteTarget, setDeleteTarget] = useState<ArtifactFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>("all");
  const [viewMode, setViewMode] = useState<FilesViewMode>(() =>
    getStoredFilesViewMode()
  );
  const { data, isLoading, isFetching, error, refetch } = useArtifactsQuery(
    profileId,
    searchQuery.trim() ? "" : folderPrefix
  );
  const deleteMutation = useDeleteArtifactMutation();
  const artifacts = data?.artifacts ?? EMPTY_ARTIFACTS;
  const totalCount = artifacts.length;
  const typeOptions = useMemo(
    () => availableArtifactTypeFilters(artifacts),
    [artifacts]
  );
  const effectiveTypeFilter: ArtifactTypeFilter = typeOptions.includes(
    typeFilter
  )
    ? typeFilter
    : "all";

  const filteredArtifacts = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();

    return artifacts.filter((artifact) => {
      if (!artifactMatchesTypeFilter(artifact, effectiveTypeFilter)) {
        return false;
      }

      if (!trimmed) {
        return true;
      }

      const haystack =
        `${artifact.filename} ${artifact.mimeType}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [artifacts, searchQuery, effectiveTypeFilter]);
  const isSearching = searchQuery.trim().length > 0;
  const listing = useMemo(() => {
    if (isSearching) {
      return { files: filteredArtifacts, folders: [] };
    }

    return listArtifactsInFolder(filteredArtifacts, folderPrefix);
  }, [filteredArtifacts, folderPrefix, isSearching]);
  const handleFolderChange = useCallback(
    (prefix: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        const normalized = normalizeArtifactFolderPrefix(prefix);
        if (normalized) {
          next.set("folder", normalized);
        } else {
          next.delete("folder");
        }
        return next;
      });
    },
    [setSearchParams]
  );

  function handleViewModeChange(mode: FilesViewMode) {
    setViewMode(mode);
    setStoredFilesViewMode(mode);
  }

  if (!profileId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center text-muted-foreground text-sm">
          No profiles available.
        </div>
      </div>
    );
  }

  async function handleDelete() {
    if (!(profileId && deleteTarget)) {
      return;
    }

    await deleteMutation.mutateAsync({
      filename: deleteTarget.filename,
      profileId,
    });
    setDeleteTarget(null);
  }

  const emptyFilterMessage = (() => {
    const parts: string[] = [];
    if (effectiveTypeFilter !== "all") {
      parts.push(
        ARTIFACT_TYPE_FILTER_LABELS[effectiveTypeFilter].toLowerCase()
      );
    }
    const trimmed = searchQuery.trim();
    if (trimmed) {
      parts.push(`“${trimmed}”`);
    }
    if (parts.length === 0) {
      if (folderPrefix && !isSearching) {
        return "This folder is empty.";
      }
      return "No artifacts match.";
    }
    return `No artifacts match ${parts.join(" · ")}.`;
  })();

  return (
    <>
      <div className="min-w-0">
        <div className="space-y-4">
          <FilesToolbar
            isFetching={isFetching}
            onRefresh={() => void refetch()}
            onViewModeChange={handleViewModeChange}
            showViewModeToggle={totalCount > 0}
            viewMode={viewMode}
          >
            <FilesSearchRow
              onSearchQueryChange={setSearchQuery}
              onTypeFilterChange={setTypeFilter}
              searchQuery={searchQuery}
              typeFilter={effectiveTypeFilter}
              typeOptions={typeOptions}
            />
          </FilesToolbar>

          {folderPrefix && !isSearching ? (
            <ArtifactFolderBreadcrumb
              onNavigate={handleFolderChange}
              prefix={folderPrefix}
            />
          ) : null}

          <FilesArtifactViews
            artifacts={artifacts}
            deletePending={deleteMutation.isPending}
            emptyFilterMessage={emptyFilterMessage}
            error={error}
            folders={listing.folders}
            isLoading={isLoading}
            key={`${folderPrefix}:${searchQuery}:${effectiveTypeFilter}`}
            listingFiles={listing.files}
            onDelete={setDeleteTarget}
            onOpenFolder={handleFolderChange}
            profileId={profileId}
            showFullPath={isSearching}
            viewMode={viewMode}
          />
        </div>
      </div>

      <FilesDeleteDialog
        deletePending={deleteMutation.isPending}
        deleteTarget={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}

function WorkspaceFilesPage({
  profileId,
  folder,
  onNavigate,
}: {
  profileId: string | null;
  folder: string;
  onNavigate: (folder: string) => void;
}) {
  const { activeOrg } = useAuth();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>("all");
  const [selected, setSelected] = useState<WorkspaceEntry | null>(null);
  const closePreview = useCallback(() => setSelected(null), []);
  const [viewMode, setViewMode] = useState<FilesViewMode>(
    getStoredFilesViewMode
  );
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    enabled: Boolean(profileId),
    queryFn: () => client.listProfileWorkspaceFiles(profileId!, folder),
    queryKey: ["workspace-files", activeOrg?.id, profileId, folder],
  });
  const typeOptions = availableArtifactTypeFilters(
    (data?.entries ?? []).filter((entry) => entry.kind !== "directory")
  );
  const entries = (data?.entries ?? []).filter(
    (entry) =>
      artifactBasename(entry.filename)
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (entry.kind === "directory" ||
        artifactMatchesTypeFilter(entry, typeFilter))
  );
  function openFolder(next: string) {
    setSearch("");
    setSelected(null);
    onNavigate(next);
  }
  if (!profileId) {
    return (
      <p className="text-muted-foreground text-sm">No profiles available.</p>
    );
  }
  return (
    <div className="space-y-4">
      <FilesToolbar
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        onViewModeChange={(mode) => {
          setViewMode(mode);
          setStoredFilesViewMode(mode);
        }}
        showViewModeToggle
        viewMode={viewMode}
      >
        <FilesSearchRow
          onSearchQueryChange={setSearch}
          onTypeFilterChange={setTypeFilter}
          searchLabel="Search current folder"
          searchQuery={search}
          typeFilter={typeFilter}
          typeOptions={typeOptions}
        />
      </FilesToolbar>
      <ArtifactFolderBreadcrumb onNavigate={openFolder} prefix={folder} />
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading files…</p>
      ) : error ? (
        <p className="text-destructive text-sm">{formatError(error)}</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {search ? "No matching files." : "This folder is empty."}
        </p>
      ) : (
        <FileEntriesLayout viewMode={viewMode}>
          {entries.map((entry) => (
            <WorkspaceEntryRow
              entry={entry}
              key={entry.path}
              onOpenFolder={openFolder}
              onSelect={setSelected}
              viewMode={viewMode}
            />
          ))}
        </FileEntriesLayout>
      )}
      {selected ? (
        <WorkspaceFilePreview
          entry={selected}
          key={selected.path}
          onClose={closePreview}
          profileId={profileId}
        />
      ) : null}
    </div>
  );
}

function WorkspaceEntryRow({
  entry,
  viewMode,
  onOpenFolder,
  onSelect,
}: {
  entry: WorkspaceEntry;
  viewMode: FilesViewMode;
  onOpenFolder: (folder: string) => void;
  onSelect: (entry: WorkspaceEntry) => void;
}) {
  const directory = entry.kind === "directory";
  return (
    <FileEntry
      {...entry}
      directory={directory}
      filename={artifactBasename(entry.filename)}
      onOpen={() => (directory ? onOpenFolder(entry.path) : onSelect(entry))}
      pinPath={entry.path}
      viewMode={viewMode}
    />
  );
}

function WorkspaceFilePreview({
  entry,
  profileId,
  onClose,
  id = `workspace:${profileId}:${entry.path}`,
}: {
  entry: WorkspaceEntry;
  profileId: string;
  onClose: () => void;
  id?: string;
}) {
  const { activeOrg } = useAuth();
  const { show, update, hide } = useChatAttachmentPanel();
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] =
    useState<ArtifactPreviewMode>("preview");
  const isMarkdown = isMarkdownArtifactMimeType(entry.mimeType);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const isImage = entry.mimeType.startsWith("image/");
  const isVideo = entry.mimeType.startsWith("video/");
  const isPdf = entry.mimeType === "application/pdf";
  const isText =
    isTextArtifactMimeType(entry.mimeType) ||
    artifactCodeLanguage(entry.filename) !== null;
  const canPreview =
    entry.sizeBytes <= 10 * 1024 * 1024 &&
    (isImage || isVideo || isPdf || isText);
  const { data, isLoading, error } = useQuery({
    enabled: canPreview,
    queryFn: async () => {
      const blob = await client.readProfileWorkspaceFile(profileId, entry.path);
      return { blob, text: isText ? await blob.text() : null };
    },
    queryKey: [
      "workspace-preview",
      activeOrg?.id,
      profileId,
      entry.path,
      entry.updatedAt,
    ],
  });
  useEffect(() => {
    if (!data) {
      return;
    }
    const url = URL.createObjectURL(data.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);
  const downloadUrl = `${client.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/workspace/content?${new URLSearchParams({ path: entry.path })}`;
  useEffect(() => {
    show({
      content: null,
      defaultWidth: artifactPanelDefaultWidth(entry.filename, entry.mimeType),
      id,
      onClose,
      title: entry.filename,
    });
    return () => hide(id);
  }, [id, entry.filename, entry.mimeType, show, hide, onClose]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const header = artifactPanelHeaderMeta({
      filename: entry.filename,
      mimeType: entry.mimeType,
      showPreviewToggle: isMarkdown,
    });
    update(id, {
      ...header,
      bodyClassName: artifactPanelBodyClassName({
        isHtml: false,
        isImage,
        isMarkdown,
        isVideo,
        previewMode,
      }),
      content: (
        <WorkspacePreviewBody
          canPreview={canPreview}
          content={data?.text ?? null}
          downloadUrl={downloadUrl}
          entry={entry}
          error={error}
          loading={isLoading}
          objectUrl={objectUrl}
          previewMode={previewMode}
        />
      ),
      fullscreen,
      headerActions: (
        <ArtifactAttachmentPanelActions
          content={data?.text ?? null}
          copied={copied}
          copyDisabled={data?.text == null}
          downloadLabel={downloadActionLabel(entry.mimeType)}
          downloadUrl={downloadUrl}
          filename={artifactBasename(entry.filename)}
          fullscreen={fullscreen}
          loading={isLoading}
          onCopy={async () => {
            if (data?.text == null) {
              return;
            }
            try {
              await navigator.clipboard.writeText(data.text);
              setCopied(true);
            } catch {
              // Clipboard may be unavailable outside secure contexts.
            }
          }}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
        />
      ),
      leading: isMarkdown ? (
        <ArtifactPreviewModeToggle
          mode={previewMode}
          onChange={setPreviewMode}
        />
      ) : null,
      resizable: !fullscreen,
    });
  }, [
    id,
    update,
    entry,
    isMarkdown,
    isImage,
    isVideo,
    fullscreen,
    copied,
    previewMode,
    data,
    isLoading,
    error,
    downloadUrl,
    objectUrl,
    canPreview,
  ]);
  return null;
}

function WorkspacePreviewBody({
  previewMode,
  entry,
  objectUrl,
  content,
  loading,
  error,
  canPreview,
  downloadUrl,
}: {
  entry: WorkspaceEntry;
  objectUrl: string | null;
  content: string | null;
  loading: boolean;
  error: unknown;
  canPreview: boolean;
  downloadUrl: string;
  previewMode: ArtifactPreviewMode;
}) {
  if (!canPreview) {
    return (
      <div className="flex min-h-64 flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center rounded-xl border border-border bg-muted/20 px-6 py-8 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-xl border border-border bg-background">
            <ArtifactIcon
              className="size-7"
              filename={entry.filename}
              mimeType={entry.mimeType}
            />
          </div>
          <h3 className="font-medium text-sm">Preview unavailable</h3>
          <p className="mt-2 max-w-full break-all text-muted-foreground text-sm">
            {artifactBasename(entry.filename)}
          </p>
          <p className="mt-1 text-muted-foreground text-xs tabular-nums">
            {formatBytes(entry.sizeBytes)}
          </p>
          <Button
            className="mt-5 min-h-10"
            nativeButton={false}
            render={
              <a
                aria-label={`Download ${artifactBasename(entry.filename)}`}
                download={artifactBasename(entry.filename)}
                href={downloadUrl}
              />
            }
          >
            <Download04Icon aria-hidden className="size-4" />
            Download file
          </Button>
        </div>
      </div>
    );
  }
  const shared = {
    artifact: toChatArtifactRef(entry),
    canPreview,
    error: error ? formatError(error) : null,
    loading,
    previewMode,
  };
  if (entry.mimeType.startsWith("image/")) {
    return (
      <ArtifactAttachmentPanelBody
        {...shared}
        imagePreviewUrl={objectUrl}
        kind="image"
      />
    );
  }
  if (entry.mimeType.startsWith("video/")) {
    return (
      <ArtifactAttachmentPanelBody
        {...shared}
        kind="video"
        videoPreviewUrl={objectUrl}
      />
    );
  }
  if (entry.mimeType === "application/pdf") {
    return (
      <ArtifactAttachmentPanelBody
        {...shared}
        kind="pdf"
        pdfPreviewUrl={objectUrl}
      />
    );
  }
  return (
    <ArtifactAttachmentPanelBody
      {...shared}
      content={content}
      format={isMarkdownArtifactMimeType(entry.mimeType) ? "markdown" : "plain"}
      kind="text"
      language={artifactCodeLanguage(entry.filename)}
    />
  );
}
