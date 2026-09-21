import type { KnowledgeBaseDocument } from "@nakama/core/contract";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { Delete02Icon, File01Icon, Upload04Icon } from "hugeicons-react";
import type { RefObject } from "react";
import { KnowledgeDocumentPreview } from "@/components/soul-tools/knowledge-document-preview";
import { formatBytes, KNOWLEDGE_BASE_ACCEPT } from "@/lib/knowledge-base-files";

/** Extend icon-sm (28px) to a 40px hit target without overlapping neighbors at gap-3. */
const iconActionHitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

const uploadedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatUploadedAt(value: string): string {
  try {
    return uploadedAtFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

function formatDocumentCount(count: number): string {
  if (count === 0) {
    return "No documents";
  }

  return count === 1 ? "1 document" : `${count} documents`;
}

export function KnowledgeTabPanel({
  documents,
  readyCount,
  profileId,
  busy,
  uploadPending,
  fileInputRef,
  onUpload,
  onDeleteDocument,
}: {
  documents: KnowledgeBaseDocument[];
  readyCount: number;
  profileId: string | null;
  busy: boolean;
  uploadPending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: FileList | null) => void;
  onDeleteDocument: (document: KnowledgeBaseDocument) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-3">
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatDocumentCount(documents.length)}
            {readyCount === documents.length ? "" : ` · ${readyCount} ready`}
            {" · "}txt, md, csv, pdf ·{" "}
            {MAX_KNOWLEDGE_DOCUMENT_BYTES / (1024 * 1024)} MB max
          </p>

          <div>
            <input
              accept={KNOWLEDGE_BASE_ACCEPT}
              className="hidden"
              multiple
              onChange={(event) => onUpload(event.target.files)}
              ref={fileInputRef}
              type="file"
            />
            <Button
              disabled={!profileId || busy}
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              type="button"
            >
              {uploadPending ? (
                <Spinner className="size-3.5" />
              ) : (
                <Upload04Icon aria-hidden className="size-3.5" />
              )}
              Add document
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">
            No documents yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((document) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors duration-100 ease-out hover:bg-muted/40"
                key={document.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <File01Icon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground text-sm">
                      {document.filename}
                    </p>
                    <p className="text-pretty text-muted-foreground text-xs">
                      {document.scope === "organization"
                        ? "Shared organization document · "
                        : "Profile document · "}
                      <span className="tabular-nums">
                        {formatBytes(document.sizeBytes)}
                      </span>
                      {" · "}
                      {formatUploadedAt(document.uploadedAt)}
                    </p>
                    {document.status === "failed" && document.error ? (
                      <p className="mt-1 text-pretty text-destructive text-xs">
                        {document.error}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium text-xs",
                      document.status === "ready"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {document.status}
                  </span>
                  <KnowledgeDocumentPreview
                    className={iconActionHitArea}
                    document={document}
                    profileId={profileId ?? ""}
                  />
                  <Button
                    aria-label={`Delete ${document.filename}`}
                    className={iconActionHitArea}
                    disabled={busy}
                    onClick={() => onDeleteDocument(document)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Delete02Icon aria-hidden className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SharedKnowledgeDocuments({
  availableDocuments,
  busy,
  documents,
  onAttach,
}: {
  availableDocuments?: KnowledgeBaseDocument[];
  busy: boolean;
  documents: KnowledgeBaseDocument[];
  onAttach: (documentId: string) => Promise<void>;
}) {
  const organizationDocuments = availableDocuments ?? [];
  const attachedOrganizationDocumentIds = new Set(
    documents
      .filter((document) => document.scope === "organization")
      .map((document) => document.id)
  );
  return (
    <section className="mb-4 rounded-md border border-border">
      <div className="border-border border-b px-4 py-3">
        <h3 className="font-medium text-sm">Shared organization knowledge</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          Attach an organization document to make it available to this profile.
          Shared documents are managed by organization administrators.
        </p>
      </div>
      {organizationDocuments.length === 0 ? (
        <p className="px-4 py-3 text-muted-foreground text-sm">
          No shared organization documents yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {organizationDocuments.map((document) => {
            const attached = attachedOrganizationDocumentIds.has(document.id);
            return (
              <li
                className="flex items-center justify-between gap-3 px-4 py-3"
                key={document.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {document.filename}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {document.status} · {document.sizeBytes.toLocaleString()}{" "}
                    bytes
                  </p>
                </div>
                <Button
                  disabled={busy || attached}
                  onClick={() => void onAttach(document.id)}
                  size="sm"
                  type="button"
                  variant={attached ? "outline" : "secondary"}
                >
                  {attached ? "Attached" : "Attach"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
