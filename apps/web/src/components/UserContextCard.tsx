import { NakamaApiError } from "@nakama/core/api-error";
import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/use-auth";
import {
  useInitUserContextMutation,
  useUserContextQuery,
  useWriteUserContextMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

function formatUserContextError(error: unknown): string {
  if (error instanceof NakamaApiError && error.status === 404) {
    return "This feature needs a newer Nakama server. Restart the server and try again.";
  }

  return formatError(error);
}

interface UserContextEditorDialogProps {
  /** When opening and USER.md is missing, scaffold then show the editor. */
  ensureExistsOnOpen?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveSuccess?: () => void;
  open: boolean;
}

/** Controlled USER.md editor dialog — used from the account menu and settings row. */
export function UserContextEditorDialog({
  open,
  onOpenChange,
  onSaveSuccess,
  ensureExistsOnOpen = false,
}: UserContextEditorDialogProps) {
  const { activeOrg } = useAuth();
  const {
    data: status,
    isLoading,
    error: loadError,
    refetch,
  } = useUserContextQuery({
    includeContent: true,
    orgId: activeOrg?.id ?? null,
  });
  const initMutation = useInitUserContextMutation();
  const writeMutation = useWriteUserContextMutation();

  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [ensuring, setEnsuring] = useState(false);
  const ensureAttemptedRef = useRef(false);

  const busy = initMutation.isPending || writeMutation.isPending || ensuring;
  const isDirty = content !== savedContent;
  const isActive = status?.active === true;

  useEffect(() => {
    if (status?.content !== undefined) {
      setContent(status.content);
      setSavedContent(status.content);
    } else if (status && !status.active) {
      setContent("");
      setSavedContent("");
    }
  }, [status]);

  useEffect(() => {
    if (!open) {
      ensureAttemptedRef.current = false;
      return;
    }

    if (
      !ensureExistsOnOpen ||
      ensureAttemptedRef.current ||
      isLoading ||
      !status
    ) {
      return;
    }

    if (isActive) {
      return;
    }

    ensureAttemptedRef.current = true;
    let cancelled = false;

    async function ensure() {
      setEnsuring(true);
      setFormError(null);
      setHint(null);
      try {
        await initMutation.mutateAsync();
        if (cancelled) {
          return;
        }
        await refetch();
      } catch (error) {
        if (!cancelled) {
          setFormError(formatUserContextError(error));
        }
      } finally {
        if (!cancelled) {
          setEnsuring(false);
        }
      }
    }

    void ensure();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    ensureExistsOnOpen,
    isActive,
    isLoading,
    status,
    initMutation,
    refetch,
  ]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setContent(savedContent);
      setFormError(null);
      setHint(null);
    }
    onOpenChange(nextOpen);
  }

  async function handleSave() {
    setFormError(null);
    setHint(null);

    try {
      await writeMutation.mutateAsync(content);
      setSavedContent(content);
      setHint("Saved. Start a new chat to apply.");
      onOpenChange(false);
      await refetch();
      onSaveSuccess?.();
    } catch (error) {
      setFormError(formatUserContextError(error));
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,40rem)] w-[calc(100%-1.5rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personalisation (USER.md)</DialogTitle>
          <DialogDescription>
            A quick note so the agent knows who you are in this org.
          </DialogDescription>
        </DialogHeader>

        {isLoading || ensuring ? (
          <div className="flex min-h-[min(50dvh,20rem)] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <Textarea
            aria-label="USER.md content"
            className="min-h-[min(50dvh,20rem)] flex-1 font-mono text-sm"
            disabled={busy}
            onChange={(event) => {
              setContent(event.target.value);
              setHint(null);
              if (formError) {
                setFormError(null);
              }
            }}
            value={content}
          />
        )}

        {formError ? (
          <p className="text-destructive text-sm" role="alert">
            {formError}
          </p>
        ) : hint ? (
          <p className="text-emerald-200 text-sm" role="status">
            {hint}
          </p>
        ) : loadError ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(loadError)}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy || !isDirty || !!loadError}
            onClick={() => void handleSave()}
            type="button"
          >
            {writeMutation.isPending ? (
              <>
                <Spinner className="mr-2" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UserContextSettingsProps {
  autoInit?: boolean;
  onSaveSuccess?: () => void;
}

/** USER.md editor row for setup wizard — render inside a parent card. */
export function UserContextSettings({
  onSaveSuccess,
  autoInit = false,
}: UserContextSettingsProps = {}) {
  const { activeOrg } = useAuth();
  const {
    data: status,
    isLoading,
    error: loadError,
    refetch,
  } = useUserContextQuery({
    includeContent: true,
    orgId: activeOrg?.id ?? null,
  });
  const initMutation = useInitUserContextMutation();

  const [editorOpen, setEditorOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const autoInitAttemptedRef = useRef(false);

  const busy = initMutation.isPending;
  const isActive = status?.active === true;

  // Auto-create USER.md in wizard contexts so the user can immediately edit
  useEffect(() => {
    if (
      !autoInit ||
      autoInitAttemptedRef.current ||
      isActive ||
      isLoading ||
      !status
    ) {
      return;
    }

    autoInitAttemptedRef.current = true;
    let cancelled = false;

    async function autoCreate() {
      setFormError(null);
      setHint(null);

      try {
        const result = await initMutation.mutateAsync();
        if (cancelled) {
          return;
        }

        await refetch();
        if (cancelled) {
          return;
        }

        if (result.created) {
          setEditorOpen(true);
        }
        setHint(
          result.created ? "Template created." : "USER.md already exists."
        );
      } catch (error) {
        if (!cancelled) {
          setFormError(formatUserContextError(error));
        }
      }
    }

    void autoCreate();

    return () => {
      cancelled = true;
    };
  }, [autoInit, isActive, isLoading, status, initMutation, refetch]);

  async function handleInit() {
    setFormError(null);
    setHint(null);

    try {
      const result = await initMutation.mutateAsync();
      await refetch();
      if (result.created) {
        setEditorOpen(true);
      }
      setHint(result.created ? "Template created." : "USER.md already exists.");
    } catch (error) {
      setFormError(formatUserContextError(error));
    }
  }

  async function handleInitAndEdit() {
    setFormError(null);
    setHint(null);

    try {
      await initMutation.mutateAsync();
      await refetch();
      setEditorOpen(true);
    } catch (error) {
      setFormError(formatUserContextError(error));
    }
  }

  const statusLine =
    hint ??
    (formError ? formError : null) ??
    (loadError ? formatError(loadError) : null);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Personalisation</p>
          {statusLine ? (
            <p
              className={cn(
                "text-xs",
                formError || loadError ? "text-destructive" : "text-emerald-200"
              )}
              role={formError || loadError ? "alert" : "status"}
            >
              {statusLine}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              USER.md — personalisation for this org
            </p>
          )}
        </div>

        {isLoading ? (
          <Spinner />
        ) : loadError ? null : isActive ? (
          <Button
            disabled={busy}
            onClick={() => setEditorOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit
          </Button>
        ) : autoInit ? (
          <Button
            disabled={busy}
            onClick={() => void handleInitAndEdit()}
            size="sm"
            type="button"
            variant="outline"
          >
            {initMutation.isPending ? (
              <>
                <Spinner className="mr-2" />
                Creating…
              </>
            ) : (
              "Edit"
            )}
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={() => void handleInit()}
            size="sm"
            type="button"
            variant="outline"
          >
            {initMutation.isPending ? (
              <>
                <Spinner className="mr-2" />
                Creating…
              </>
            ) : (
              "Create"
            )}
          </Button>
        )}
      </div>

      <UserContextEditorDialog
        onOpenChange={setEditorOpen}
        onSaveSuccess={onSaveSuccess}
        open={editorOpen}
      />
    </>
  );
}
