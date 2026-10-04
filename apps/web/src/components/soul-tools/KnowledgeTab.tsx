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
import { useEffect, useRef, useState } from "react";
import {
  KnowledgeTabPanel,
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
import { formatError } from "@/lib/client";
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

  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;
  const documents = knowledgeBase?.documents ?? [];
  const readyCount = documents.filter(
    (document) => document.status === "ready"
  ).length;
  const loading = knowledgeLoading && !knowledgeBase;
  const busy =
    uploading ||
    uploadMutation.isPending ||
    importZipMutation.isPending ||
    attachSharedMutation.isPending ||
    deleteMutation.isPending ||
    detachSharedMutation.isPending ||
    duplicatePrompt !== null;

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
        if (isKnowledgeBaseZipFile(file)) {
          if (file.size > MAX_KNOWLEDGE_ZIP_BYTES) {
            setError(`${file.name} exceeds the 20 MB ZIP limit.`);
            break;
          }
          try {
            const zipBase64 = await fileToZipBase64(file);
            const result = await importZipMutation.mutateAsync({
              profileId,
              zipBase64,
            });
            setImportResult(result);
          } catch (err) {
            setError(formatError(err));
            break;
          }
          continue;
        }

        if (!isKnowledgeBaseFile(file)) {
          setError(`Unsupported file type: ${file.name}.`);
          continue;
        }

        const document = await fileToDocumentAttachment(file);
        if (!document) {
          setError(`Failed to read file: ${file.name}`);
          continue;
        }

        try {
          await uploadMutation.mutateAsync({ document, profileId });
        } catch (err) {
          if (!(err instanceof NakamaApiError && err.status === 409)) {
            setError(formatError(err));
            break;
          }

          const decision = await askDuplicateDecision(file.name);
          if (decision === "replace") {
            try {
              await uploadMutation.mutateAsync({
                document,
                onDuplicate: "replace",
                profileId,
              });
            } catch (replaceErr) {
              setError(formatError(replaceErr));
              break;
            }
          }
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
          <div
            className="mb-4 rounded-md border border-border px-4 py-3 text-sm"
            role="status"
          >
            <p className="font-medium">
              ZIP import: {importResult.totals.created} added,{" "}
              {importResult.totals.duplicate} duplicates,{" "}
              {importResult.totals.unsupported} unsupported,{" "}
              {importResult.totals.error} errors
              {importResult.totals.failedExtraction > 0
                ? `, ${importResult.totals.failedExtraction} unreadable`
                : ""}
            </p>
            {importResult.entries.some(
              (entry) =>
                entry.outcome !== "created" || entry.status === "failed"
            ) ? (
              <ul className="mt-2 list-inside list-disc text-muted-foreground">
                {importResult.entries
                  .filter(
                    (entry) =>
                      entry.outcome !== "created" || entry.status === "failed"
                  )
                  .map((entry) => (
                    <li key={entry.filename}>
                      {entry.filename}:{" "}
                      {entry.outcome === "created"
                        ? "unreadable"
                        : entry.outcome}
                      {entry.match ? ` (${entry.match.replace("_", " ")})` : ""}
                      {entry.reason ? ` — ${entry.reason}` : ""}
                    </li>
                  ))}
              </ul>
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
          uploadPending={
            uploading || uploadMutation.isPending || importZipMutation.isPending
          }
        />
      </div>

      <DeleteKnowledgeDocumentDialog
        busy={deleteMutation.isPending || detachSharedMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        profileName={selectedProfile?.name ?? "this profile"}
        target={deleteTarget}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open && duplicatePrompt) {
            duplicatePrompt.resolve("skip");
            setDuplicatePrompt(null);
          }
        }}
        open={duplicatePrompt !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate document</DialogTitle>
            <DialogDescription>
              {duplicatePrompt?.filename} is already in this knowledge base.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                duplicatePrompt?.resolve("skip");
                setDuplicatePrompt(null);
              }}
              type="button"
              variant="outline"
            >
              Skip
            </Button>
            <Button
              onClick={() => {
                duplicatePrompt?.resolve("replace");
                setDuplicatePrompt(null);
              }}
              type="button"
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
