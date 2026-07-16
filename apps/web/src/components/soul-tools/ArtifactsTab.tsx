import type { ArtifactFile } from "@nakama/core/contract";
import { FileDownIcon, FileTextIcon, ImageIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useArtifactsQuery, useDeleteArtifactMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { client } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

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

function ArtifactIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) {
    return <ImageIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />;
  }

  return <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />;
}

export function ArtifactsTab({ profileId }: { profileId: string | null }) {
  const [deleteTarget, setDeleteTarget] = useState<ArtifactFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useArtifactsQuery(profileId);
  const deleteMutation = useDeleteArtifactMutation();

  const filteredArtifacts = useMemo(() => {
    const artifacts = data?.artifacts ?? [];
    const trimmed = searchQuery.trim().toLowerCase();

    if (!trimmed) {
      return artifacts;
    }

    return artifacts.filter((artifact) => {
      const haystack = `${artifact.filename} ${artifact.mimeType}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [data?.artifacts, searchQuery]);

  if (!profileId) {
    return null;
  }

  async function handleDelete() {
    if (!profileId || !deleteTarget) {
      return;
    }

    await deleteMutation.mutateAsync({
      profileId,
      filename: deleteTarget.filename,
    });
    setDeleteTarget(null);
  }

  return (
    <>
      <div className="space-y-4">
        <section className={sectionClass}>
          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Artifacts</h2>
                <p className="text-xs text-muted-foreground">
                  Persistent files saved by the agent under `artifacts/`.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {isFetching ? <Spinner className="mr-2 size-4" /> : null}
                Refresh
              </Button>
            </div>

            {data && data.artifacts.length > 0 ? (
              <div className="relative">
                <SearchIcon
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search files…"
                  className="h-8 border-border/60 bg-muted/20 pl-8 text-sm shadow-none focus-visible:border-foreground/20 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-foreground/10 dark:bg-muted/15 dark:focus-visible:bg-background/60"
                />
              </div>
            ) : null}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading artifacts…
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-sm text-destructive">{formatError(error)}</div>
          ) : !data || data.artifacts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No artifacts yet.
            </div>
          ) : filteredArtifacts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No artifacts match &ldquo;{searchQuery.trim()}&rdquo;.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredArtifacts.map((artifact) => (
                <li
                  key={artifact.filename}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <ArtifactIcon mimeType={artifact.mimeType} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {artifact.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {artifact.mimeType} · {formatBytes(artifact.sizeBytes)} · {formatTimestamp(artifact.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={getArtifactDownloadUrl(profileId, artifact.filename)}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <FileDownIcon className="mr-2 size-4" aria-hidden />
                      Download
                    </a>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteTarget(artifact)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete artifact</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.filename} from this profile?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleteMutation.isPending}
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
