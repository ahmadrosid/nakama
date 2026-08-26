import type { ProfilePackPreviewResponse } from "@nakama/core/contract";
import { Alert02Icon, Archive01Icon, CloudUploadIcon } from "hugeicons-react";
import { useRef, useState } from "react";
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
import {
  useImportProfilePackMutation,
  usePreviewProfilePackImportMutation,
} from "@/hooks/use-profile-pack";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface ProfileImportDialogProps {
  onImported: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function ProfileImportDialog({
  onImported,
  onOpenChange,
  open,
}: ProfileImportDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <ProfileImportDialogContent
          onImported={onImported}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function ProfileImportDialogContent({
  onImported,
  onOpenChange,
}: {
  onImported: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<ProfilePackPreviewResponse | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewMutation = usePreviewProfilePackImportMutation();
  const importMutation = useImportProfilePackMutation();
  const busy = previewMutation.isPending || importMutation.isPending;
  const confirmEnabled =
    Boolean(selectedFile) && Boolean(preview) && !previewError && !busy;

  async function handleFileSelected(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setPreviewError(null);

    if (!file) {
      return;
    }

    try {
      setPreview(await previewMutation.mutateAsync(file));
    } catch (err) {
      setPreviewError(formatError(err));
    }
  }

  async function handleConfirm() {
    if (!(selectedFile && preview)) {
      return;
    }

    try {
      const response = await importMutation.mutateAsync({
        file: selectedFile,
      });
      toast(`Imported "${response.manifest.meta.name}".`);
      onOpenChange(false);
      onImported(response.profileId);
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <DialogContent className="flex max-h-[min(90dvh,42rem)] flex-col gap-6 overflow-hidden p-6 sm:max-w-lg">
      <DialogHeader className="gap-2 pr-8 text-left">
        <DialogTitle className="text-balance">Import profile</DialogTitle>
        <DialogDescription className="text-pretty">
          Upload a profile pack (.zip) exported from Nakama.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <button
          aria-label="Choose a profile pack file"
          className={cn(
            "flex min-h-40 w-full shrink-0 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center outline-none transition-[background-color,border-color,color] disabled:pointer-events-none disabled:opacity-50",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-background hover:border-primary/60 hover:bg-muted/30"
          )}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void handleFileSelected(event.dataTransfer.files[0] ?? null);
          }}
          type="button"
        >
          <CloudUploadIcon
            aria-hidden
            className="mb-4 size-9 text-primary"
            strokeWidth={1.5}
          />
          <span className="font-medium text-foreground">
            Drag and drop your .zip file here
          </span>
          <span className="mt-1 text-muted-foreground text-sm">
            or click to browse
          </span>
        </button>
        <input
          accept=".zip,application/zip"
          aria-label="Choose a profile pack file"
          className="sr-only"
          disabled={busy}
          onChange={(event) =>
            void handleFileSelected(event.target.files?.[0] ?? null)
          }
          ref={inputRef}
          type="file"
        />

        {selectedFile ? (
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-start gap-3 p-3">
              <div
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
              >
                <Archive01Icon className="size-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-medium text-foreground text-sm">
                  {selectedFile.name}
                </p>
                {previewMutation.isPending ? (
                  <p className="text-muted-foreground text-xs">
                    Checking file…
                  </p>
                ) : preview ? (
                  <p className="text-pretty text-muted-foreground text-xs">
                    Will create{" "}
                    <span className="font-medium text-foreground">
                      {preview.plannedName}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>

            {previewError ? (
              <div className="border-border border-t p-3">
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                    "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                  role="alert"
                >
                  <Alert02Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="text-pretty">{previewError}</span>
                </div>
              </div>
            ) : null}

            {preview ? (
              <div className="space-y-3 border-border border-t p-3">
                {preview.topLevelPaths.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="font-medium text-muted-foreground text-xs">
                      Included
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {preview.topLevelPaths.map((path) => (
                        <li
                          className="rounded-md bg-muted px-2 py-0.5 font-mono text-2xs text-muted-foreground"
                          key={path}
                        >
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {preview.skippedAssignments.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="font-medium text-muted-foreground text-xs">
                      Skipped — not found in this org
                    </p>
                    <ul className="space-y-1">
                      {preview.skippedAssignments.map((item) => (
                        <li
                          className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-700 text-xs dark:text-amber-400"
                          key={item.path}
                        >
                          <span className="font-mono">{item.path}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            — {item.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
        <Button
          disabled={busy}
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={!confirmEnabled}
          onClick={() => void handleConfirm()}
          type="button"
        >
          {importMutation.isPending ? (
            <Spinner className="size-4" />
          ) : (
            "Confirm"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
