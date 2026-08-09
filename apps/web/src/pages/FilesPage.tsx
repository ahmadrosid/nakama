import type { ArtifactFile } from "@nakama/core/contract";
import {
  Delete02Icon,
  File02Icon,
  FileDownloadIcon,
  Film02Icon,
  GridViewIcon,
  Image02Icon,
  ListViewIcon,
  MoreHorizontalIcon,
  Refresh01Icon,
  Search01Icon,
} from "hugeicons-react";
import { useMemo, useState } from "react";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  type ArtifactTypeFilter,
  artifactMatchesTypeFilter,
  availableArtifactTypeFilters,
  classifyArtifactType,
} from "@/components/soul-tools/artifacts-tab-filters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useArtifactsQuery,
  useDeleteArtifactMutation,
} from "@/hooks/use-resource-mutations";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import {
  type FilesViewMode,
  getStoredFilesViewMode,
  resolveFilesProfileId,
  setStoredFilesViewMode,
} from "@/lib/files-page.shared";
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

const EMPTY_ARTIFACTS: ArtifactFile[] = [];

/** Extend icon-sm (28px) to a 40px hit target without overlapping neighbors at gap-3. */
const iconActionHitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

function toChatArtifactRef(artifact: ArtifactFile): ChatArtifactRef {
  return {
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    path: artifact.path || artifact.filename,
    savedAt: artifact.updatedAt,
    sizeBytes: artifact.sizeBytes,
  };
}
const artifactTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string): string {
  try {
    return artifactTimestampFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

function getArtifactDownloadUrl(profileId: string, filename: string): string {
  const query = new URLSearchParams({ path: filename });
  return `${client.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`;
}

function ArtifactIcon({
  mimeType,
  filename,
  className,
}: {
  mimeType: string;
  filename: string;
  className?: string;
}) {
  const kind = classifyArtifactType({
    filename,
    mimeType,
    path: filename,
    sizeBytes: 0,
    updatedAt: "",
  });
  const iconClass = cn("size-4 text-muted-foreground", className);

  if (kind === "image") {
    return <Image02Icon aria-hidden className={iconClass} />;
  }

  if (kind === "video") {
    return <Film02Icon aria-hidden className={iconClass} />;
  }

  return <File02Icon aria-hidden className={iconClass} />;
}

function ArtifactRowMenu({
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
  const artifactPath = artifact.path || artifact.filename;
  const share = useArtifactShareControls({ artifactPath, profileId });
  const downloadUrl = getArtifactDownloadUrl(profileId, artifactPath);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Artifact actions"
              className={iconActionHitArea}
              size="icon-sm"
              type="button"
              variant="outline"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <ArtifactShareMenuItem share={share} />
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => {
              const link = document.createElement("a");
              link.href = downloadUrl;
              link.download = artifact.filename;
              link.rel = "noopener";
              document.body.append(link);
              link.click();
              link.remove();
            }}
          >
            <FileDownloadIcon aria-hidden />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={deletePending}
            onClick={onDelete}
            variant="destructive"
          >
            <Delete02Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArtifactSharePublishDialogFromState
        artifactPath={artifactPath}
        share={share}
      />
    </>
  );
}

function FilesViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: FilesViewMode;
  onChange: (mode: FilesViewMode) => void;
}) {
  return (
    <div
      aria-label="View mode"
      className="flex shrink-0 items-center rounded-md border border-border/60 p-0.5"
      role="group"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => onChange("list")}
              size="icon-sm"
              type="button"
              variant={viewMode === "list" ? "secondary" : "ghost"}
            >
              <ListViewIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="bottom" sideOffset={6}>
          List
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => onChange("grid")}
              size="icon-sm"
              type="button"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
            >
              <GridViewIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="bottom" sideOffset={6}>
          Grid
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

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

export function FilesPage() {
  const { profileId: activeProfileId } = useActiveChatProfile();
  const { data: profiles = [] } = useProfilesQuery();
  const profileId = resolveFilesProfileId({ activeProfileId, profiles });

  const [deleteTarget, setDeleteTarget] = useState<ArtifactFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>("all");
  const [viewMode, setViewMode] = useState<FilesViewMode>(() =>
    getStoredFilesViewMode()
  );
  const { data, isLoading, isFetching, error, refetch } =
    useArtifactsQuery(profileId);
  const deleteMutation = useDeleteArtifactMutation();

  const artifacts = data?.artifacts ?? EMPTY_ARTIFACTS;
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
      return "No artifacts match.";
    }
    return `No artifacts match ${parts.join(" · ")}.`;
  })();

  return (
    <ChatAttachmentPanelProvider presentation="overlay">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-section-title text-balance">Artifacts</h2>
            <div className="flex shrink-0 items-center gap-2">
              {artifacts.length > 0 ? (
                <FilesViewModeToggle
                  onChange={handleViewModeChange}
                  viewMode={viewMode}
                />
              ) : null}
              <Button
                onClick={() => void refetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                {isFetching ? (
                  <Spinner className="size-4" />
                ) : (
                  <Refresh01Icon aria-hidden className="size-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>

          {artifacts.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search01Icon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  className="h-8 border-border/60 bg-muted/20 pl-8 text-sm shadow-none focus-visible:border-foreground/20 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-foreground/10 dark:bg-muted/15 dark:focus-visible:bg-background/60"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search files…"
                  value={searchQuery}
                />
              </div>
              <Select
                onValueChange={(value) => {
                  if (value != null) {
                    setTypeFilter(value as ArtifactTypeFilter);
                  }
                }}
                value={effectiveTypeFilter}
              >
                <SelectTrigger
                  aria-label="Filter by file type"
                  className="h-8 w-full shrink-0 border-border/60 bg-muted/20 shadow-none sm:w-40 dark:bg-muted/15"
                >
                  <SelectValue>
                    {ARTIFACT_TYPE_FILTER_LABELS[effectiveTypeFilter]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ARTIFACT_TYPE_FILTER_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {viewMode === "grid" &&
          !isLoading &&
          !error &&
          filteredArtifacts.length > 0 ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
              {filteredArtifacts.map((artifact) => (
                <ArtifactGridCard
                  artifact={artifact}
                  deletePending={deleteMutation.isPending}
                  key={artifact.filename}
                  onDelete={() => setDeleteTarget(artifact)}
                  profileId={profileId}
                />
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-border">
              {isLoading ? (
                viewMode === "grid" ? (
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
                ) : (
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
                <ul className="divide-y divide-border">
                  {filteredArtifacts.map((artifact) => (
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
                          deletePending={deleteMutation.isPending}
                          onDelete={() => setDeleteTarget(artifact)}
                          profileId={profileId}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        open={deleteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete artifact</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.filename} from this profile?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete()}
              type="button"
              variant="destructive"
            >
              {deleteMutation.isPending ? <Spinner className="size-4" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChatAttachmentPanelProvider>
  );
}
