import type {
  KnowledgeBaseDocument,
  KnowledgeBaseSource,
} from "@nakama/core/contract";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  Delete02Icon,
  File01Icon,
  Link01Icon,
  LinkSquare02Icon,
  Upload04Icon,
} from "hugeicons-react";
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
  sources,
  documents,
  readyCount,
  profileId,
  busy,
  uploadPending,
  fileInputRef,
  onUpload,
  onDeleteDocument,
}: {
  sources: KnowledgeBaseSource[];
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
      <div className="min-w-0">
        <h2 className="type-section-title text-balance">Knowledge</h2>
      </div>

      {sources.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {sources.map((source) => (
            <li key={source.id}>
              <a
                className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                href={source.url}
                rel="noreferrer"
                target="_blank"
                title={source.url}
              >
                <Link01Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{source.title}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  Inherited
                </span>
                <LinkSquare02Icon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

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
