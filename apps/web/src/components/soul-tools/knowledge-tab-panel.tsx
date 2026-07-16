import type { KnowledgeBaseDocument, KnowledgeBaseSource } from "@nakama/core/contract";
import {
  ExternalLinkIcon,
  FileTextIcon,
  LinkIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  formatBytes,
  KNOWLEDGE_BASE_ACCEPT,
} from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

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

export function KnowledgeTabPanel({
  embedded,
  selectedProfileName,
  knowledgeBaseDirectory,
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
  embedded: boolean;
  selectedProfileName?: string;
  knowledgeBaseDirectory: string | null;
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
    <div className={embedded ? undefined : "min-w-0 p-4 sm:p-5"}>
      <div className="mb-4 min-w-0">
        {!embedded ? (
          <h2 className="type-section-title">{selectedProfileName ?? "Profile"}</h2>
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
              onChange={(event) => onUpload(event.target.files)}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={!profileId || busy}
            >
              {uploadPending ? <Spinner className="size-4" /> : <UploadIcon className="size-4" />}
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
                    onClick={() => onDeleteDocument(document)}
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
}
