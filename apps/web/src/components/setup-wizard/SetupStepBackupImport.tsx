import type { DataImportPreviewResponse } from "@nakama/core/contract";
import {
  Alert02Icon,
  CheckmarkCircle01Icon,
  Upload04Icon,
} from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
import {
  DataImportPreview,
  PendingIcon,
} from "@/components/data-portability/DataImportPreview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  canRestoreDataImport,
  shouldClearInitialPreviewDedupe,
  shouldStartInitialFilePreview,
  usePreviewSetupDataImport,
  useRestoreSetupDataImport,
} from "@/hooks/use-data-portability";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

const REDIRECT_DELAY_MS = 3000;

type RestorePhase = "form" | "restoring" | "done";

interface SetupStepBackupImportProps {
  initialFile?: File | null;
  onBack: () => void;
  onRestored: () => void;
}

export function SetupStepBackupImport({
  initialFile = null,
  onBack,
  onRestored,
}: SetupStepBackupImportProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialPreviewStartedForRef = useRef<File | null>(null);
  const previewGenerationRef = useRef(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DataImportPreviewResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RestorePhase>("form");
  const [successEntered, setSuccessEntered] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const { mutateAsync: previewImport, isPending: previewPending } =
    usePreviewSetupDataImport();
  const restoreMutation = useRestoreSetupDataImport();
  const isBusy =
    previewPending || restoreMutation.isPending || phase !== "form";
  const restoreAvailable = canRestoreDataImport({
    pending: restoreMutation.isPending || phase !== "form",
    previewReady: Boolean(preview),
    selectedFile,
  });

  async function handlePreview(file: File | null) {
    const generation = ++previewGenerationRef.current;
    setSelectedFile(file);
    setPreview(null);
    setError(null);

    if (!file) {
      return;
    }

    try {
      const result = await previewImport(file);
      if (generation !== previewGenerationRef.current) {
        return;
      }
      setPreview(result);
    } catch (err) {
      if (generation !== previewGenerationRef.current) {
        return;
      }
      setError(formatError(err));
    }
  }

  useEffect(() => {
    if (!initialFile) {
      initialPreviewStartedForRef.current = null;
      return;
    }

    // useMutation's result object changes identity when pending/error state flips.
    // Depend on stable mutateAsync only, and skip if we already started this File.
    if (
      !shouldStartInitialFilePreview(
        initialFile,
        initialPreviewStartedForRef.current
      )
    ) {
      return;
    }
    initialPreviewStartedForRef.current = initialFile;
    const generation = ++previewGenerationRef.current;

    let cancelled = false;
    setSelectedFile(initialFile);
    setPreview(null);
    setError(null);

    void previewImport(initialFile)
      .then((result) => {
        if (!cancelled && generation === previewGenerationRef.current) {
          setPreview(result);
        }
      })
      .catch((err) => {
        if (!cancelled && generation === previewGenerationRef.current) {
          setError(formatError(err));
        }
      });

    return () => {
      cancelled = true;
      // Strict Mode remount may retry the same File only when this generation
      // is still current — do not clear a newer in-flight preview's dedupe key.
      if (
        shouldClearInitialPreviewDedupe(
          generation,
          previewGenerationRef.current
        )
      ) {
        initialPreviewStartedForRef.current = null;
      }
    };
  }, [initialFile, previewImport]);

  const onRestoredRef = useRef(onRestored);

  useEffect(() => {
    onRestoredRef.current = onRestored;
  }, [onRestored]);

  useEffect(() => {
    if (phase !== "done") {
      setSuccessEntered(false);
      return;
    }

    const enterFrame = requestAnimationFrame(() => setSuccessEntered(true));
    if (requiresRestart) {
      return () => {
        cancelAnimationFrame(enterFrame);
      };
    }

    const redirectTimer = window.setTimeout(() => {
      onRestoredRef.current();
    }, REDIRECT_DELAY_MS);

    return () => {
      cancelAnimationFrame(enterFrame);
      window.clearTimeout(redirectTimer);
    };
  }, [phase, requiresRestart]);

  async function handleRestore() {
    if (!(selectedFile && preview)) {
      return;
    }

    setError(null);
    setRequiresRestart(false);
    setPhase("restoring");

    try {
      const result = await restoreMutation.mutateAsync({
        confirm: true,
        file: selectedFile,
      });
      setRequiresRestart(Boolean(result.requiresRestart));
      setPhase("done");
    } catch (err) {
      setPhase("form");
      setError(formatError(err));
    }
  }

  if (phase === "restoring" || phase === "done") {
    return (
      <Card className="p-6">
        <div
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-3 py-10 text-center"
          role="status"
        >
          {phase === "restoring" ? (
            <>
              <Spinner className="size-8 text-primary" />
              <p className="text-balance font-medium text-foreground text-sm">
                Restoring backup…
              </p>
            </>
          ) : (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-10 items-center justify-center text-primary",
                  "transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                  "motion-reduce:transition-none",
                  successEntered
                    ? "scale-100 opacity-100 blur-0"
                    : "scale-[0.25] opacity-0 blur-[4px]"
                )}
              >
                <CheckmarkCircle01Icon className="size-10" strokeWidth={1.75} />
              </span>
              <div
                className={cn(
                  "space-y-1 transition-[opacity,filter,translate] duration-300 ease-out",
                  "motion-reduce:transition-none",
                  successEntered
                    ? "translate-y-0 opacity-100 blur-0 delay-100"
                    : "translate-y-3 opacity-0 blur-[4px]"
                )}
              >
                <p className="text-balance font-medium text-foreground text-sm">
                  Backup restored
                </p>
                <p className="text-pretty text-muted-foreground text-xs">
                  {requiresRestart
                    ? "Restart Nakama, then sign in with your restored account."
                    : "Taking you to sign in…"}
                </p>
              </div>
            </>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-balance font-medium text-foreground text-sm">
            Restore from a backup
          </p>
          <Button
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
            size="sm"
            type="button"
            variant={selectedFile ? "outline" : "default"}
          >
            <PendingIcon idle={Upload04Icon} pending={previewPending} />
            {selectedFile ? "Choose a different file" : "Choose backup file"}
          </Button>
          <input
            accept=".zip,application/zip"
            aria-label="Choose a backup file"
            className="sr-only"
            disabled={isBusy}
            onChange={(event) =>
              void handlePreview(event.target.files?.[0] ?? null)
            }
            ref={inputRef}
            type="file"
          />
        </div>

        {selectedFile ? (
          <DataImportPreview
            fileName={selectedFile.name}
            inspecting={previewPending}
            onRestore={() => void handleRestore()}
            preview={preview}
            restoreDisabled={!restoreAvailable}
            restorePending={restoreMutation.isPending}
          />
        ) : null}

        {error ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            <Alert02Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">{error}</span>
          </div>
        ) : null}

        <Button
          className="w-full"
          disabled={isBusy}
          onClick={onBack}
          type="button"
          variant="outline"
        >
          Back to account setup
        </Button>
      </div>
    </Card>
  );
}
