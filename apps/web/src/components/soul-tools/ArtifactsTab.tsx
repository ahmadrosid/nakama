import type { ArtifactFile } from "@nakama/core/contract";
import {
  FileDownIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
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
  useArtifactsQuery,
  useDeleteArtifactMutation,
} from "@/hooks/use-resource-mutations";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";

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
}: {
  mimeType: string;
  filename: string;
}) {
  const kind = classifyArtifactType({
    filename,
    mimeType,
    path: filename,
    sizeBytes: 0,
    updatedAt: "",
  });

  if (kind === "image") {
    return (
      <ImageIcon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
    );
  }

  if (kind === "video") {
    return (
      <FilmIcon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
    );
  }

  return (
    <FileTextIcon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
  );
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
            <FileDownIcon aria-hidden />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={deletePending}
            onClick={onDelete}
            variant="destructive"
          >
            <Trash2Icon aria-hidden />
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

export function ArtifactsTab({ profileId }: { profileId: string | null }) {
  const [deleteTarget, setDeleteTarget] = useState<ArtifactFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>("all");
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

  if (!profileId) {
    return null;
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
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-section-title text-balance">Artifacts</h2>
          <Button
            onClick={() => void refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isFetching ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCwIcon aria-hidden className="size-4" />
            )}
            Refresh
          </Button>
        </div>

        {artifacts.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
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

        <div className="rounded-md border border-border">
          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Loading artifacts…
            </div>
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
                      id={`artifacts-tab:${artifact.path || artifact.filename}`}
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
    </>
  );
}
