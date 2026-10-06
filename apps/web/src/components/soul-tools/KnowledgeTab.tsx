import { NakamaApiError } from "@nakama/core/api-error";
import type {
  ImportKnowledgeBaseZipResponse,
  KnowledgeBaseDocument,
} from "@nakama/core/contract";
import { MAX_KNOWLEDGE_ZIP_BYTES } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  KnowledgeTabPanel,
  KnowledgeZipImportResult,
  SharedKnowledgeDocuments,
} from "@/components/soul-tools/knowledge-tab-panel";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useAttachSharedKnowledgeBaseDocumentMutation,
  useDeleteKnowledgeBaseDocumentMutation,
  useDetachSharedKnowledgeBaseDocumentMutation,
  useImportKnowledgeBaseZipMutation,
  useKnowledgeBaseQuery,
  useOrganizationKnowledgeBaseQuery,
  useUploadKnowledgeBaseDocumentMutation,
} from "@/hooks/use-resource-mutations";
import { client, formatError } from "@/lib/client";
import {
  fileToDocumentAttachment,
  fileToZipBase64,
  isKnowledgeBaseFile,
  isKnowledgeBaseZipFile,
} from "@/lib/knowledge-base-files";

type DuplicateDecision = "skip" | "replace";

type DuplicatePrompt = {
  filename: string;
  resolve: (decision: DuplicateDecision) => void;
};

export function KnowledgeTab({ profileId }: { profileId: string | null }) {
  const queryClient = useQueryClient();
  const { activeOrg } = useAuth();
  const { data: profiles = [], error: profilesError } = useProfilesQuery();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    data: knowledgeBase = null,
    isLoading: knowledgeLoading,
    error: knowledgeError,
  } = useKnowledgeBaseQuery(profileId);
  const { data: organizationKnowledgeBase = null } =
    useOrganizationKnowledgeBaseQuery(activeOrg?.id ?? null);
  const uploadMutation = useUploadKnowledgeBaseDocumentMutation();
  const importZipMutation = useImportKnowledgeBaseZipMutation();
  const attachSharedMutation = useAttachSharedKnowledgeBaseDocumentMutation();
  const deleteMutation = useDeleteKnowledgeBaseDocumentMutation();
  const detachSharedMutation = useDetachSharedKnowledgeBaseDocumentMutation();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] =
    useState<ImportKnowledgeBaseZipResponse | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<KnowledgeBaseDocument | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] =
    useState<DuplicatePrompt | null>(null);
  const [showIndex, setShowIndex] = useState(false);
  const [indexTopic, setIndexTopic] = useState<string | undefined>();
  const [indexOffset, setIndexOffset] = useState(0);
  const indexQuery = useQuery({
    enabled: Boolean(profileId),
    queryFn: () => client.getKnowledgeIndex(profileId!),
    queryKey: ["knowledge-index", profileId],
    refetchInterval: 5000,
  });
  const indexPreviewQuery = useQuery({
    enabled: Boolean(profileId && showIndex),
    queryFn: () =>
      client.getKnowledgeIndex(profileId!, indexTopic, indexOffset),
    queryKey: ["knowledge-index", profileId, indexTopic, indexOffset],
  });
  const indexMutation = useMutation({
    mutationFn: (
      action:
        | "enable"
        | "disable"
        | "backfill"
        | "retry"
        | "rebuild"
        | "reanalyze"
    ) => client.changeKnowledgeIndex(profileId!, action),
    onError: (err) => setError(formatError(err)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["knowledge-index", profileId],
      });
    },
  });

  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;
  const documents = knowledgeBase?.documents ?? [];
  const readyCount = documents.filter(
    (document) => document.status === "ready"
  ).length;
  const loading = knowledgeLoading && !knowledgeBase;
  const uploadPending = [
    uploading,
    uploadMutation.isPending,
    importZipMutation.isPending,
  ].some(Boolean);
  const busy = [
    uploadPending,
    attachSharedMutation.isPending,
    deleteMutation.isPending,
    detachSharedMutation.isPending,
    duplicatePrompt !== null,
  ].some(Boolean);

  useEffect(() => {
    const queryError = profilesError ?? knowledgeError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, knowledgeError]);

  function askDuplicateDecision(filename: string): Promise<DuplicateDecision> {
    return new Promise((resolve) => {
      setDuplicatePrompt({ filename, resolve });
    });
  }

  function resolveDuplicateDecision(decision: DuplicateDecision) {
    duplicatePrompt?.resolve(decision);
    setDuplicatePrompt(null);
  }

  async function handleZipUpload(file: File, currentProfileId: string) {
    if (file.size > MAX_KNOWLEDGE_ZIP_BYTES) {
      setError(`${file.name} exceeds the 20 MB ZIP limit.`);
      return false;
    }

    try {
      const zipBase64 = await fileToZipBase64(file);
      const result = await importZipMutation.mutateAsync({
        profileId: currentProfileId,
        zipBase64,
      });
      setImportResult(result);
      return true;
    } catch (err) {
      setError(formatError(err));
      return false;
    }
  }

  async function handleDocumentUpload(file: File, currentProfileId: string) {
    if (!isKnowledgeBaseFile(file)) {
      setError(`Unsupported file type: ${file.name}.`);
      return true;
    }

    const document = await fileToDocumentAttachment(file);
    if (!document) {
      setError(`Failed to read file: ${file.name}`);
      return true;
    }

    try {
      await uploadMutation.mutateAsync({
        document,
        profileId: currentProfileId,
      });
      return true;
    } catch (err) {
      if (!(err instanceof NakamaApiError && err.status === 409)) {
        setError(formatError(err));
        return false;
      }
    }

    if ((await askDuplicateDecision(file.name)) === "skip") {
      return true;
    }

    try {
      await uploadMutation.mutateAsync({
        document,
        onDuplicate: "replace",
        profileId: currentProfileId,
      });
      return true;
    } catch (err) {
      setError(formatError(err));
      return false;
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!(profileId && files?.length)) {
      return;
    }

    setError(null);
    setImportResult(null);
    setUploading(true);

    try {
      if (Array.from(files).filter(isKnowledgeBaseZipFile).length > 1) {
        setError("Select one ZIP at a time.");
        return;
      }
      for (const file of Array.from(files)) {
        const shouldContinue = isKnowledgeBaseZipFile(file)
          ? await handleZipUpload(file, profileId)
          : await handleDocumentUpload(file, profileId);
        if (!shouldContinue) {
          break;
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleAttachSharedDocument(documentId: string) {
    if (!profileId) {
      return;
    }

    setError(null);
    try {
      await attachSharedMutation.mutateAsync({ documentId, profileId });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleDelete() {
    if (!(profileId && deleteTarget)) {
      return;
    }

    setError(null);

    try {
      if (deleteTarget.scope === "organization") {
        await detachSharedMutation.mutateAsync({
          documentId: deleteTarget.id,
          profileId,
        });
      } else {
        await deleteMutation.mutateAsync({
          documentId: deleteTarget.id,
          profileId,
        });
      }
      setDeleteTarget(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  if (!profileId) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a profile to manage knowledge base documents.
      </p>
    );
  }

  if (loading && !knowledgeBase) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        Loading knowledge base…
      </div>
    );
  }

  return (
    <>
      <div className="min-w-0">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {importResult ? (
          <KnowledgeZipImportResult result={importResult} />
        ) : null}

        {indexQuery.data ? (
          <div className="mb-4 rounded-md border border-border px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                Index: {indexQuery.data.status.replace("_", " ")} ·{" "}
                {indexQuery.data.indexedCount}/{indexQuery.data.readyCount}{" "}
                ready
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={indexMutation.isPending}
                  onClick={() =>
                    indexMutation.mutate(
                      indexQuery.data!.enabled ? "disable" : "enable"
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  {indexQuery.data.enabled ? "Turn off" : "Enable index"}
                </Button>
                {indexQuery.data.enabled ? (
                  <>
                    <Button
                      disabled={indexMutation.isPending}
                      onClick={() => indexMutation.mutate("backfill")}
                      size="sm"
                      variant="outline"
                    >
                      Analyze documents
                    </Button>
                    <Button
                      disabled={
                        indexMutation.isPending ||
                        indexQuery.data.status === "updating"
                      }
                      onClick={() => indexMutation.mutate("reanalyze")}
                      size="sm"
                      variant="outline"
                    >
                      Reanalyze
                    </Button>
                    <Button
                      disabled={
                        indexMutation.isPending ||
                        indexQuery.data.status === "updating" ||
                        indexQuery.data.failed + indexQuery.data.pending === 0
                      }
                      onClick={() => indexMutation.mutate("retry")}
                      size="sm"
                      variant="outline"
                    >
                      Approve next batch
                    </Button>
                    <Button
                      disabled={indexMutation.isPending}
                      onClick={() => indexMutation.mutate("rebuild")}
                      size="sm"
                      variant="outline"
                    >
                      Rebuild index
                    </Button>
                    <Button
                      onClick={() => setShowIndex((value) => !value)}
                      size="sm"
                      variant="outline"
                    >
                      {showIndex ? "Close index" : "View index"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              {indexQuery.data.provider ?? "No supported model"} · 4,000 input
              bytes and 300 output tokens per document · six documents per batch
              · {indexQuery.data.pending} pending · {indexQuery.data.failed}{" "}
              need retry
            </p>
            {showIndex ? (
              <div className="mt-3 border-border border-t pt-3">
                {indexTopic ? (
                  <Button
                    onClick={() => {
                      setIndexTopic(undefined);
                      setIndexOffset(0);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    All topics
                  </Button>
                ) : null}
                {(indexTopic ? "" : (indexPreviewQuery.data?.content ?? ""))
                  .split("\n")
                  .filter((line) => line.startsWith("## "))
                  .map((line) => (
                    <Button
                      key={line}
                      onClick={() => {
                        setIndexTopic(line.slice(3));
                        setIndexOffset(0);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {line.slice(3)}
                    </Button>
                  ))}
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                  {indexPreviewQuery.data?.content}
                </pre>
                {indexPreviewQuery.data?.nextOffset === undefined ? null : (
                  <Button
                    onClick={() =>
                      setIndexOffset(indexPreviewQuery.data!.nextOffset!)
                    }
                    size="sm"
                    variant="outline"
                  >
                    Next page
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <SharedKnowledgeDocuments
          availableDocuments={organizationKnowledgeBase?.documents}
          busy={busy}
          documents={documents}
          onAttach={handleAttachSharedDocument}
        />

        <KnowledgeTabPanel
          busy={busy}
          documents={documents}
          fileInputRef={fileInputRef}
          onDeleteDocument={setDeleteTarget}
          onUpload={(files) => void handleUpload(files)}
          profileId={profileId}
          readyCount={readyCount}
          uploadPending={uploadPending}
        />
      </div>

      <DeleteKnowledgeDocumentDialog
        busy={deleteMutation.isPending || detachSharedMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        profileName={selectedProfile?.name ?? "this profile"}
        target={deleteTarget}
      />

      <DuplicateKnowledgeDocumentDialog
        onDecision={resolveDuplicateDecision}
        prompt={duplicatePrompt}
      />
    </>
  );
}

function DuplicateKnowledgeDocumentDialog({
  onDecision,
  prompt,
}: {
  onDecision: (decision: DuplicateDecision) => void;
  prompt: DuplicatePrompt | null;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && prompt) {
          onDecision("skip");
        }
      }}
      open={prompt !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate document</DialogTitle>
          <DialogDescription>
            {prompt?.filename} is already in this knowledge base.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => onDecision("skip")}
            type="button"
            variant="outline"
          >
            Skip
          </Button>
          <Button onClick={() => onDecision("replace")} type="button">
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteKnowledgeDocumentDialog({
  busy,
  onClose,
  onConfirm,
  profileName,
  target,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  profileName: string;
  target: KnowledgeBaseDocument | null;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={target !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target?.scope === "organization"
              ? "Detach shared document"
              : "Delete document"}
          </DialogTitle>
          <DialogDescription>
            {target?.scope === "organization"
              ? `Detach ${target.filename} from ${profileName}? The organization document will remain available to other profiles.`
              : `Remove ${target?.filename} from ${profileName}?`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onClose()} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {busy ? <Spinner className="size-4" /> : null}
            {target?.scope === "organization" ? "Detach" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
