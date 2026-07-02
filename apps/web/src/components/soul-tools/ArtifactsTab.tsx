import type { ArtifactFile } from "@tinyclaw/core/contract";
import { FileDownIcon, FileTextIcon, ImageIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useArtifactsQuery, useDeleteArtifactMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { client } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

function formatTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
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
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useArtifactsQuery(profileId);
  const deleteMutation = useDeleteArtifactMutation();

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
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
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
          ) : (
            <ul className="divide-y divide-border">
              {data.artifacts.map((artifact) => (
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
                      <Trash2Icon className="mr-2 size-4" aria-hidden />
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
