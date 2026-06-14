import type { KnowledgeBaseDocument } from "@tinyclaw/core/contract";
import {
  BookOpenIcon,
  FileTextIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useDeleteKnowledgeBaseDocumentMutation,
  useKnowledgeBaseQuery,
  useUploadKnowledgeBaseDocumentMutation,
} from "@/hooks/use-resource-mutations";
import {
  fileToDocumentAttachment,
  formatBytes,
  isKnowledgeBaseFile,
  KNOWLEDGE_BASE_ACCEPT,
} from "@/lib/knowledge-base-files";
import { DEFAULT_PROFILE_ID } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { formatError } from "@/lib/client";

const sectionClass = "rounded-md border border-border bg-card";

function resolveDefaultProfileId(
  profiles: Array<{ id: string }>,
  fromUrl: string | null,
): string | null {
  if (profiles.length === 0) {
    return null;
  }

  if (fromUrl && profiles.some((profile) => profile.id === fromUrl)) {
    return fromUrl;
  }

  return profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID)?.id ?? profiles[0]!.id;
}

function formatUploadedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function KnowledgeTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: profiles = [],
    error: profilesError,
    isFetching: profilesFetching,
    refetch: refetchProfiles,
  } = useProfilesQuery();
  const [profileId, setProfileIdState] = useState<string | null>(null);
  const profileInitializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    data: knowledgeBase = null,
    isLoading: knowledgeLoading,
    isFetching: knowledgeFetching,
    error: knowledgeError,
    refetch: refetchKnowledgeBase,
  } = useKnowledgeBaseQuery(profileId);
  const uploadMutation = useUploadKnowledgeBaseDocumentMutation();
  const deleteMutation = useDeleteKnowledgeBaseDocumentMutation();
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBaseDocument | null>(null);

  const documents = knowledgeBase?.documents ?? [];
  const loading = knowledgeLoading && !knowledgeBase;
  const refreshing = profilesFetching || knowledgeFetching;
  const busy = uploadMutation.isPending || deleteMutation.isPending;

  const setProfileId = useCallback(
    (nextProfileId: string) => {
      setProfileIdState(nextProfileId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextProfileId === DEFAULT_PROFILE_ID) {
            next.delete("profile");
          } else {
            next.set("profile", nextProfileId);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    const nextProfileId = resolveDefaultProfileId(profiles, searchParams.get("profile"));

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      setProfileIdState(nextProfileId);
      return;
    }

    if (profileId && profiles.some((profile) => profile.id === profileId)) {
      return;
    }

    setProfileIdState(nextProfileId);
  }, [profiles, profileId, searchParams]);

  useEffect(() => {
    const queryError = profilesError ?? knowledgeError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, knowledgeError]);

  async function refresh() {
    setError(null);
    await Promise.all([refetchProfiles(), refetchKnowledgeBase()]);
  }

  async function handleUpload(files: FileList | null) {
    if (!profileId || !files?.length) {
      return;
    }

    setError(null);

    for (const file of Array.from(files)) {
      if (!isKnowledgeBaseFile(file)) {
        setError(`Unsupported file type: ${file.name}. Allowed: txt, md, csv, pdf.`);
        continue;
      }

      try {
        const document = await fileToDocumentAttachment(file);
        if (!document) {
          setError(`Failed to read file: ${file.name}`);
          continue;
        }

        await uploadMutation.mutateAsync({ profileId, document });
      } catch (err) {
        setError(formatError(err));
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDelete() {
    if (!profileId || !deleteTarget) {
      return;
    }

    setError(null);

    try {
      await deleteMutation.mutateAsync({
        profileId,
        documentId: deleteTarget.id,
      });
      setDeleteTarget(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  if (profiles.length === 0 && !profilesFetching) {
    return (
      <div className={cn(sectionClass, "p-8 text-sm text-muted-foreground")}>
        Create a profile first to add knowledge base documents.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={cn(sectionClass, "flex flex-wrap items-center justify-between gap-3 p-4")}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BookOpenIcon className="size-4" strokeWidth={1.75} aria-hidden />
            Knowledge Base
          </div>
          <p className="text-sm text-muted-foreground">
            Upload project docs here. The agent looks up facts with knowledge_base_search.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={profileId ?? undefined}
            onValueChange={(value) => {
              if (value) {
                setProfileId(value);
              }
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className={cn(sectionClass, "p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Documents</h3>
            <p className="text-sm text-muted-foreground">
              Text and PDF files up to 5 MB. Content is extracted and searched on demand.
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={KNOWLEDGE_BASE_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files)}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={!profileId || busy}
            >
              {uploadMutation.isPending ? <Spinner className="size-4" /> : <UploadIcon className="size-4" />}
              Upload
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading documents…
          </div>
        ) : documents.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No documents yet. Upload reference files for this profile.
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{document.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(document.sizeBytes)} · {formatUploadedAt(document.uploadedAt)}
                    </p>
                    {document.status === "failed" && document.error ? (
                      <p className="mt-1 text-xs text-destructive">{document.error}</p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      document.status === "ready"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {document.status}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${document.filename}`}
                    onClick={() => setDeleteTarget(document)}
                    disabled={busy}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.filename} from this profile&apos;s knowledge base?
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
    </div>
  );
}
