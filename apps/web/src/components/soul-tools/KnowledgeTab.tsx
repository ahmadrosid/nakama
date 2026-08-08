import type { KnowledgeBaseDocument } from "@nakama/core/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { KnowledgeTabPanel } from "@/components/soul-tools/knowledge-tab-panel";
import {
  KnowledgeTabPageState,
  KnowledgeTabShell,
} from "@/components/soul-tools/knowledge-tab-shell";
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
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useDeleteKnowledgeBaseDocumentMutation,
  useKnowledgeBaseQuery,
  useSoulStatusQuery,
  useUploadKnowledgeBaseDocumentMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import {
  fileToDocumentAttachment,
  isKnowledgeBaseFile,
} from "@/lib/knowledge-base-files";
import { findDefaultProfile, resolveInitialProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";
const KNOWLEDGE_BASE_SUBDIR = "knowledge-base";

function resolveDefaultProfileId(
  profiles: Array<{ id: string }>,
  fromUrl: string | null
): string | null {
  if (profiles.length === 0) {
    return null;
  }

  if (fromUrl && profiles.some((profile) => profile.id === fromUrl)) {
    return fromUrl;
  }

  return resolveInitialProfileId(profiles);
}

export function KnowledgeTab({
  profileId: controlledProfileId,
}: {
  profileId?: string | null;
} = {}) {
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
  const [deleteTarget, setDeleteTarget] =
    useState<KnowledgeBaseDocument | null>(null);

  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;
  const documents = knowledgeBase?.documents ?? [];
  const sources = knowledgeBase?.sources ?? [];
  const readyCount = documents.filter(
    (document) => document.status === "ready"
  ).length;
  const loading = knowledgeLoading && !knowledgeBase;
  const refreshing =
    profilesFetching || knowledgeFetching || soulStatusFetching;
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
        { replace: true }
      );
    },
    [setSearchParams, profiles]
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
    await Promise.all([
      refetchProfiles(),
      refetchKnowledgeBase(),
      refetchSoulStatus(),
    ]);
  }

  async function handleUpload(files: FileList | null) {
    if (!(profileId && files?.length)) {
      return;
    }

    setError(null);

    await Promise.all(
      Array.from(files).map(async (file) => {
        if (!isKnowledgeBaseFile(file)) {
          setError(
            `Unsupported file type: ${file.name}. Allowed: txt, md, csv, pdf.`
          );
          return;
        }

        try {
          const document = await fileToDocumentAttachment(file);
          if (!document) {
            setError(`Failed to read file: ${file.name}`);
            return;
          }

          await uploadMutation.mutateAsync({ document, profileId });
        } catch (err) {
          setError(formatError(err));
        }
      })
    );

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDelete() {
    if (!(profileId && deleteTarget)) {
      return;
    }

    setError(null);

    try {
      await deleteMutation.mutateAsync({
        documentId: deleteTarget.id,
        profileId,
      });
      setDeleteTarget(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  if (!embedded && profiles.length === 0 && !profilesFetching) {
    return (
      <div className={cn(sectionClass, "p-8 text-muted-foreground text-sm")}>
        Create a profile first to add knowledge base documents.
      </div>
    );
  }

  if (embedded && !profileId) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a profile to manage knowledge base documents.
      </p>
    );
  }

  if (loading && !knowledgeBase) {
    return (
      <KnowledgeTabPageState
        embedded={embedded}
        message="Loading knowledge base…"
      />
    );
  }

  const knowledgePanel = (
    <KnowledgeTabPanel
      busy={busy}
      documents={documents}
      embedded={embedded}
      fileInputRef={fileInputRef}
      knowledgeBaseDirectory={knowledgeBaseDirectory}
      onDeleteDocument={setDeleteTarget}
      onUpload={(files) => void handleUpload(files)}
      profileId={profileId}
      readyCount={readyCount}
      selectedProfileName={selectedProfile?.name}
      sources={sources}
      uploadPending={uploadMutation.isPending}
    />
  );

  return (
    <>
      {error ? (
        <p
          className={cn(
            "rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm",
            !embedded && "mb-4"
          )}
        >
          {error}
        </p>
      ) : null}

      {embedded ? (
        knowledgePanel
      ) : (
        <KnowledgeTabShell
          busy={busy}
          onProfileSelect={setProfileId}
          onRefresh={() => void refresh()}
          panel={knowledgePanel}
          profileId={profileId}
          profiles={profiles}
          refreshing={refreshing}
          selectedProfileName={selectedProfile?.name}
        />
      )}

      <Dialog
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        open={deleteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.filename} from{" "}
              {selectedProfile?.name ?? "this profile"}?
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
