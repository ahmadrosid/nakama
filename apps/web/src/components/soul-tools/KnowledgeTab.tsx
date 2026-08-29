import { NakamaApiError } from "@nakama/core/api-error";
import type { KnowledgeBaseDocument } from "@nakama/core/contract";
import { useEffect, useRef, useState } from "react";
import { KnowledgeTabPanel } from "@/components/soul-tools/knowledge-tab-panel";
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
  useUploadKnowledgeBaseDocumentMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import {
  fileToDocumentAttachment,
  isKnowledgeBaseFile,
} from "@/lib/knowledge-base-files";

type DuplicateDecision = "skip" | "replace" | "cancel";

type DuplicatePrompt = {
  filename: string;
  resolve: (decision: DuplicateDecision) => void;
};

export function KnowledgeTab({ profileId }: { profileId: string | null }) {
  const { data: profiles = [], error: profilesError } = useProfilesQuery();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    data: knowledgeBase = null,
    isLoading: knowledgeLoading,
    error: knowledgeError,
  } = useKnowledgeBaseQuery(profileId);
  const uploadMutation = useUploadKnowledgeBaseDocumentMutation();
  const deleteMutation = useDeleteKnowledgeBaseDocumentMutation();
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<KnowledgeBaseDocument | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] =
    useState<DuplicatePrompt | null>(null);

  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;
  const documents = knowledgeBase?.documents ?? [];
  const sources = knowledgeBase?.sources ?? [];
  const readyCount = documents.filter(
    (document) => document.status === "ready"
  ).length;
  const loading = knowledgeLoading && !knowledgeBase;
  const busy =
    uploadMutation.isPending ||
    deleteMutation.isPending ||
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

    for (const file of Array.from(files)) {
      if (!isKnowledgeBaseFile(file)) {
        setError(
          `Unsupported file type: ${file.name}. Allowed: txt, md, csv, pdf.`
        );
        continue;
      }

      try {
        const document = await fileToDocumentAttachment(file);
        if (!document) {
          setError(`Failed to read file: ${file.name}`);
          continue;
        }

        try {
          await uploadMutation.mutateAsync({ document, profileId });
        } catch (err) {
          if (!(err instanceof NakamaApiError && err.status === 409)) {
            throw err;
          }

          const decision = await askDuplicateDecision(file.name);
          if (decision === "cancel" || decision === "skip") {
            continue;
          }

          await uploadMutation.mutateAsync({
            document,
            onDuplicate: "replace",
            profileId,
          });
        }
      } catch (err) {
        setError(formatError(err));
        break;
      }
    }

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
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <KnowledgeTabPanel
        busy={busy}
        documents={documents}
        fileInputRef={fileInputRef}
        onDeleteDocument={setDeleteTarget}
        onUpload={(files) => void handleUpload(files)}
        profileId={profileId}
        readyCount={readyCount}
        sources={sources}
        uploadPending={uploadMutation.isPending}
      />

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

      <Dialog
        onOpenChange={(open) => {
          if (!open && duplicatePrompt) {
            duplicatePrompt.resolve("cancel");
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
                duplicatePrompt?.resolve("cancel");
                setDuplicatePrompt(null);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
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
