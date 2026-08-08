import type {
  KnowledgeBaseDocument,
  KnowledgeBaseSource,
} from "@nakama/core/contract";
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
import { formatBytes, KNOWLEDGE_BASE_ACCEPT } from "@/lib/knowledge-base-files";
import { cn } from "@/lib/utils";

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
    <div className={cn("space-y-4", !embedded && "min-w-0 p-4 sm:p-5")}>
      <div className="min-w-0">
        <h2 className="type-section-title text-balance">
          {embedded ? "Knowledge" : (selectedProfileName ?? "Profile")}
        </h2>
        {!embedded && knowledgeBaseDirectory ? (
          <p
            className="type-code mt-2 truncate text-muted-foreground"
            title={knowledgeBaseDirectory}
          >
            {knowledgeBaseDirectory}
          </p>
        ) : null}
      </div>

      {sources.length > 0 ? (
        <div className="rounded-md border border-border">
          <div className="border-border border-b px-4 py-3">
            <p className="text-muted-foreground text-xs tabular-nums">
              {sources.length === 1
                ? "1 inherited source"
                : `${sources.length} inherited sources`}
            </p>
          </div>
          <ul className="divide-y divide-border">
            {sources.map((source) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors duration-100 ease-out hover:bg-muted/40"
                key={source.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <LinkIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground text-sm">
                      {source.title}
                    </p>
                    <p className="line-clamp-2 text-pretty text-muted-foreground text-xs">
                      {source.description}
                    </p>
                    <a
                      className="mt-1 inline-flex max-w-full items-center gap-1 text-primary text-xs hover:underline"
                      href={source.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="truncate">{source.url}</span>
                      <ExternalLinkIcon
                        aria-hidden
                        className="size-3 shrink-0"
                      />
                    </a>
                  </div>
                </div>

                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
                  inherited
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-3">
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatDocumentCount(documents.length)}
            {readyCount === documents.length ? "" : ` · ${readyCount} ready`}
            {" · "}txt, md, csv, pdf · 5 MB max
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
                <UploadIcon aria-hidden className="size-3.5" />
              )}
              Upload
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
                  <FileTextIcon
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
                  <Button
                    aria-label={`Delete ${document.filename}`}
                    className={iconActionHitArea}
                    disabled={busy}
                    onClick={() => onDeleteDocument(document)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2Icon aria-hidden className="size-4" />
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
