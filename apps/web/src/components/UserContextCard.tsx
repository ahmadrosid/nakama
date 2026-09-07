import { NakamaApiError } from "@nakama/core/api-error";
import { useState } from "react";
import {
  clearUserContextDraft,
  UserContextForm,
  useUserContextEditor,
} from "@/components/UserContextForm";
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
import { useAuth } from "@/context/use-auth";
import {
  useUserContextQuery,
  useWriteUserContextMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

function formatUserContextError(error: unknown): string {
  if (error instanceof NakamaApiError && error.status === 404) {
    return "This feature needs a newer Nakama server. Restart the server and try again.";
  }

  return formatError(error);
}

interface UserContextEditorDialogProps {
  onOpenChange: (open: boolean) => void;
  onSaveSuccess?: () => void;
  open: boolean;
}

/** Controlled USER.md editor dialog, used from the account menu and settings row. */
export function UserContextEditorDialog({
  open,
  onOpenChange,
  onSaveSuccess,
}: UserContextEditorDialogProps) {
  const { activeOrg, user } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const {
    data: status,
    isLoading,
    error: loadError,
    refetch,
  } = useUserContextQuery({
    includeContent: true,
    orgId,
  });
  const writeMutation = useWriteUserContextMutation();
  const { content, savedContent, setContent, setSavedContent } =
    useUserContextEditor({
      defaultName: user?.name,
      orgId,
      resetKey: open,
      status,
    });

  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const busy = writeMutation.isPending;
  const isDirty = content !== savedContent;

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
      clearUserContextDraft(orgId);
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
      <DialogContent className="flex max-h-[min(90dvh,44rem)] w-[calc(100%-1.5rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personalisation (USER.md)</DialogTitle>
          <DialogDescription>
            A quick note so the agent knows who you are in this org. Every
            answer is optional.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex min-h-[min(50dvh,20rem)] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            <UserContextForm
              disabled={busy}
              idPrefix="user-context-dialog"
              onChange={(next) => {
                setContent(next);
                setHint(null);
                if (formError) {
                  setFormError(null);
                }
              }}
              value={content}
            />
          </div>
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
  onSaveSuccess?: () => void;
}

function UserContextStatusCopy({
  isActive,
  loadError,
}: {
  isActive: boolean;
  loadError: unknown;
}) {
  if (loadError) {
    return (
      <p className="text-destructive text-xs" role="alert">
        {formatError(loadError)}
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-xs">
      {isActive
        ? "USER.md is set for this org"
        : "Answer a few questions so replies fit how you work"}
    </p>
  );
}

/** USER.md row for settings and the setup wizard. Render inside a parent card. */
export function UserContextSettings({
  onSaveSuccess,
}: UserContextSettingsProps = {}) {
  const { activeOrg } = useAuth();
  const {
    data: status,
    isLoading,
    error: loadError,
  } = useUserContextQuery({
    includeContent: true,
    orgId: activeOrg?.id ?? null,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const isActive = status?.active === true;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Personalisation</p>
          <UserContextStatusCopy isActive={isActive} loadError={loadError} />
        </div>

        {isLoading ? <Spinner /> : null}

        {isLoading || loadError ? null : (
          <Button
            onClick={() => setEditorOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isActive ? "Edit" : "Set up"}
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
