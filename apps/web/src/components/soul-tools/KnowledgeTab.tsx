import type { KnowledgeBaseDocument } from "@nakama/core/contract";
import {
  ExternalLinkIcon,
  FileTextIcon,
  LinkIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
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
  useSoulStatusQuery,
  useUploadKnowledgeBaseDocumentMutation,
} from "@/hooks/use-resource-mutations";
import {
  fileToDocumentAttachment,
  formatBytes,
  isKnowledgeBaseFile,
  KNOWLEDGE_BASE_ACCEPT,
} from "@/lib/knowledge-base-files";
import { findDefaultProfile, resolveInitialProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { formatError } from "@/lib/client";

const sectionClass = "rounded-md border border-border bg-card";
const KNOWLEDGE_BASE_SUBDIR = "knowledge-base";

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

  return resolveInitialProfileId(profiles);
}

function formatUploadedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatDocumentCount(count: number): string {
  if (count === 0) {
    return "No documents";
  }

  return count === 1 ? "1 document" : `${count} documents`;
}

export function KnowledgeTab({ profileId: controlledProfileId }: { profileId?: string | null } = {}) {
  const embedded = controlledProfileId !== undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: profiles = [],
    error: profilesError,
    isFetching: profilesFetching,
    refetch: refetchProfiles,
  } = useProfilesQuery();
  const [internalProfileId, setProfileIdState] = useState<string | null>(null);
  const profileInitializedRef = useRef(false);
  const profileId = embedded ? controlledProfileId : internalProfileId;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    data: knowledgeBase = null,
    isLoading: knowledgeLoading,
    isFetching: knowledgeFetching,
    error: knowledgeError,
    refetch: refetchKnowledgeBase,
  } = useKnowledgeBaseQuery(profileId);
  const {
    data: soulStatus = null,
    isFetching: soulStatusFetching,
    refetch: refetchSoulStatus,
  } = useSoulStatusQuery(profileId);
  const uploadMutation = useUploadKnowledgeBaseDocumentMutation();
  const deleteMutation = useDeleteKnowledgeBaseDocumentMutation();
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBaseDocument | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const documents = knowledgeBase?.documents ?? [];
  const sources = knowledgeBase?.sources ?? [];
  const readyCount = documents.filter((document) => document.status === "ready").length;
  const loading = knowledgeLoading && !knowledgeBase;
  const refreshing = profilesFetching || knowledgeFetching || soulStatusFetching;
  const busy = uploadMutation.isPending || deleteMutation.isPending;
  const knowledgeBaseDirectory = soulStatus
    ? `${soulStatus.directory}/${KNOWLEDGE_BASE_SUBDIR}`
    : null;

  const setProfileId = useCallback(
    (nextProfileId: string) => {
      setProfileIdState(nextProfileId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const defaultProfileId = findDefaultProfile(profiles)?.id;
          if (defaultProfileId && nextProfileId === defaultProfileId) {
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
    if (embedded) {
      return;
    }

    const nextProfileId = resolveDefaultProfileId(profiles, searchParams.get("profile"));

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      setProfileIdState(nextProfileId);
      return;
    }

    if (internalProfileId && profiles.some((profile) => profile.id === internalProfileId)) {
      return;
    }

    setProfileIdState(nextProfileId);
  }, [embedded, profiles, internalProfileId, searchParams]);

  useEffect(() => {
    const queryError = profilesError ?? knowledgeError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, knowledgeError]);

  async function refresh() {
    setError(null);
    await Promise.all([refetchProfiles(), refetchKnowledgeBase(), refetchSoulStatus()]);
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

  if (!embedded && profiles.length === 0 && !profilesFetching) {
    return (
      <div className={cn(sectionClass, "p-8 text-sm text-muted-foreground")}>
        Create a profile first to add knowledge base documents.
      </div>
    );
  }

  if (embedded && !profileId) {
    return (
      <p className="text-sm text-muted-foreground">Select a profile to manage knowledge base documents.</p>
    );
  }

  if (loading && !knowledgeBase) {
    return <PageState message="Loading knowledge base…" embedded={embedded} />;
  }

  const knowledgePanel = (
    <div className={embedded ? undefined : "min-w-0 p-4 sm:p-5"}>
      <div className="mb-4 min-w-0">
        {!embedded ? (
          <h2 className="type-section-title">{selectedProfile?.name ?? "Profile"}</h2>
        ) : null}
        <p className={cn("type-body text-xs", !embedded && "mt-1")}>
          Knowledge base · one library per profile
        </p>
        {knowledgeBaseDirectory ? (
          <p
            className="type-code mt-2 truncate text-muted-foreground"
            title={knowledgeBaseDirectory}
          >
            {knowledgeBaseDirectory}
          </p>
        ) : null}
      </div>

      {sources.length > 0 ? (
        <div className="mb-4 rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              {sources.length === 1 ? "1 inherited source" : `${sources.length} inherited sources`}
            </p>
          </div>
          <ul className="divide-y divide-border">
            {sources.map((source) => (
              <li
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <LinkIcon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{source.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {source.description}
                    </p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <span className="truncate">{source.url}</span>
                      <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
                    </a>
                  </div>
                </div>

                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  inherited
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatDocumentCount(documents.length)}
            {readyCount !== documents.length ? ` · ${readyCount} ready` : ""}
            {" · "}txt, md, csv, pdf · 5 MB max
          </p>

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
              {uploadMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <UploadIcon className="size-4" />
              )}
              Upload
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No documents yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileTextIcon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
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
    </div>
  );

  return (
    <>
      {error ? (
        <p
          className={cn(
            "rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive",
            !embedded && "mb-4",
          )}
        >
          {error}
        </p>
      ) : null}

      {embedded ? (
        knowledgePanel
      ) : (
        <section className={cn(sectionClass, "overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:hidden">
            <Select
              value={profileId ?? undefined}
              disabled={busy || refreshing || !profileId}
              onValueChange={(value) => {
                if (value) {
                  setProfileId(String(value));
                }
              }}
            >
              <SelectTrigger className="min-w-0 flex-1" aria-label="Profile">
                <SelectValue placeholder="Select profile">
                  {selectedProfile?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    <span className="flex items-center gap-2">
                      <ProfileAvatar profile={profile} size="sm" />
                      <span>{profile.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy || refreshing}
                aria-label="Refresh knowledge base"
                onClick={() => void refresh()}
              >
                {refreshing ? (
                  <Spinner className="size-4" />
                ) : (
                  <RefreshCwIcon className="size-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden border-b border-border p-4 lg:block lg:border-r lg:border-b-0">
              <h2 className="type-section-title mb-4">Profiles</h2>

              <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 lg:max-h-none">
                {profiles.map((profile) => (
                  <ScopeButton
                    key={profile.id}
                    active={profile.id === profileId}
                    title={profile.name}
                    leading={<ProfileAvatar profile={profile} size="sm" />}
                    onClick={() => setProfileId(profile.id)}
                  />
                ))}
              </div>
            </aside>

            {knowledgePanel}
          </div>
        </section>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.filename} from {selectedProfile?.name ?? "this profile"}?
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

function ScopeButton({
  active,
  title,
  leading,
  onClick,
}: {
  active: boolean;
  title: string;
  leading?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className="scope-item"
    >
      <div className="flex items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              active ? "text-primary" : "text-foreground",
            )}
          >
            {title}
          </p>
        </div>
      </div>
    </button>
  );
}

function PageState({ message, embedded = false }: { message: string; embedded?: boolean }) {
  return (
    <div
      className={cn(
        embedded
          ? "flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          : cn(
              sectionClass,
              "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
            ),
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
