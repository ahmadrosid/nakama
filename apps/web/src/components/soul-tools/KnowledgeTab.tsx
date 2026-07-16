import type { KnowledgeBaseDocument } from "@nakama/core/contract";
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
import { Spinner } from "@/components/ui/spinner";
import { KnowledgeTabPanel } from "@/components/soul-tools/knowledge-tab-panel";
import {
  KnowledgeTabPageState,
  KnowledgeTabShell,
} from "@/components/soul-tools/knowledge-tab-shell";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useDeleteKnowledgeBaseDocumentMutation,
  useKnowledgeBaseQuery,
  useSoulStatusQuery,
  useUploadKnowledgeBaseDocumentMutation,
} from "@/hooks/use-resource-mutations";
import {
  fileToDocumentAttachment,
  isKnowledgeBaseFile,
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
    [setSearchParams, profiles],
  );

  useEffect(() => {
    if (embedded) {
      return;
    }

    if (profiles.length === 0) {
      return;
    }

    const urlProfile = searchParams.get("profile");
    const nextProfileId = resolveDefaultProfileId(profiles, urlProfile);

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      setProfileIdState(nextProfileId);
      return;
    }

    setProfileIdState((current) => {
      if (
        urlProfile &&
        profiles.some((profile) => profile.id === urlProfile) &&
        urlProfile !== current
      ) {
        return urlProfile;
      }

      if (current && profiles.some((profile) => profile.id === current)) {
        return current;
      }

      return nextProfileId;
    });
  }, [embedded, profiles, searchParams]);

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
    return <KnowledgeTabPageState message="Loading knowledge base…" embedded={embedded} />;
  }

  const knowledgePanel = (
    <KnowledgeTabPanel
      embedded={embedded}
      selectedProfileName={selectedProfile?.name}
      knowledgeBaseDirectory={knowledgeBaseDirectory}
      sources={sources}
      documents={documents}
      readyCount={readyCount}
      profileId={profileId}
      busy={busy}
      uploadPending={uploadMutation.isPending}
      fileInputRef={fileInputRef}
      onUpload={(files) => void handleUpload(files)}
      onDeleteDocument={setDeleteTarget}
    />
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
        <KnowledgeTabShell
          profiles={profiles}
          profileId={profileId}
          selectedProfileName={selectedProfile?.name}
          busy={busy}
          refreshing={refreshing}
          panel={knowledgePanel}
          onProfileSelect={setProfileId}
          onRefresh={() => void refresh()}
        />
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
