import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Textarea } from "@nakama/ui/textarea";
import { CodeIcon, Delete02Icon } from "hugeicons-react";
import { useState } from "react";
import { useSaveTelegramSettings } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  type AllowedTelegramUser,
  parseAllowedTelegramUsers,
} from "@/lib/parse-allowed-telegram-users";

interface TelegramAllowedUsersDialogProps {
  allowedUsers: AllowedTelegramUser[];
  onAllowedUsersChange: (users: AllowedTelegramUser[]) => void;
  onError?: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  open: boolean;
  profileId: string;
}

export function TelegramAllowedUsersDialog({
  open,
  onOpenChange,
  allowedUsers,
  onAllowedUsersChange,
  profileId,
  onSaved,
  onError,
}: TelegramAllowedUsersDialogProps) {
  const saveMutation = useSaveTelegramSettings();

  const [newAllowedUserInput, setNewAllowedUserInput] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AllowedTelegramUser | null>(
    null
  );

  function saveAllowedUsers(
    nextUsers: AllowedTelegramUser[],
    afterSuccess?: () => void
  ) {
    // Optimistic, so a failed save has to put the old list back. Otherwise the
    // dialog shows a user as removed while the bot still answers them, which is
    // the wrong direction to be wrong in for an access list.
    const previousUsers = allowedUsers;
    onAllowedUsersChange(nextUsers);
    setFormError(null);

    saveMutation.mutate(
      {
        allowedUserIds: nextUsers.map((user) => user.id).join(","),
        profileId: profileId.trim() || "default",
      },
      {
        onError: (err) => {
          onAllowedUsersChange(previousUsers);
          const message = formatError(err);
          setFormError(message);
          onError?.(message);
        },
        onSuccess: () => {
          onSaved?.();
          afterSuccess?.();
        },
      }
    );
  }

  function addAllowedUserId() {
    let users: AllowedTelegramUser[];

    try {
      users = parseAllowedTelegramUsers(newAllowedUserInput);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (users.length === 0) {
      return;
    }

    const next = new Map(allowedUsers.map((user) => [user.id, user]));
    users.forEach((user) => {
      const existing = next.get(user.id);
      next.set(user.id, { ...existing, ...user });
    });

    saveAllowedUsers([...next.values()], () => {
      setNewAllowedUserInput("");
    });
  }

  function openImportDialog() {
    setImportDraft("");
    setImportError(null);
    setImportOpen(true);
  }

  function handleImportApply() {
    let users: AllowedTelegramUser[];

    try {
      users = parseAllowedTelegramUsers(importDraft);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (users.length === 0) {
      return;
    }

    const next = new Map(allowedUsers.map((user) => [user.id, user]));
    users.forEach((user) => {
      const existing = next.get(user.id);
      next.set(user.id, { ...existing, ...user });
    });

    saveAllowedUsers([...next.values()], () => {
      setImportOpen(false);
      setImportDraft("");
      setImportError(null);
    });
  }

  function confirmRemoveAllowedUser() {
    if (!removeTarget) {
      return;
    }

    const id = removeTarget.id;
    // Closed before the save resolves on purpose: a failed save rolls the list
    // back and renders its error in the dialog underneath, which nobody can
    // read through an open confirm.
    setRemoveTarget(null);
    saveAllowedUsers(allowedUsers.filter((entry) => entry.id !== id));
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle>Telegram Users</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-sm">Add user ID</p>
              <Button
                className="text-muted-foreground hover:text-foreground"
                disabled={saveMutation.isPending}
                onClick={openImportDialog}
                size="xs"
                type="button"
                variant="ghost"
              >
                <CodeIcon aria-hidden />
                Import JSON
              </Button>
            </div>
            <InputGroup>
              <InputGroupInput
                className="font-mono text-sm ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={saveMutation.isPending}
                onChange={(event) => {
                  setNewAllowedUserInput(event.target.value);
                  if (formError) {
                    setFormError(null);
                  }
                }}
                placeholder="213193924"
                value={newAllowedUserInput}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  disabled={
                    saveMutation.isPending || !newAllowedUserInput.trim()
                  }
                  onClick={addAllowedUserId}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Add user
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {formError ? (
              <div className="">
                <p
                  className="rounded-md bg-destructive/10 px-2.5 py-1 text-destructive text-xs"
                  role="alert"
                >
                  {formError}
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="font-medium text-sm">Users</p>

            <div className="h-40 space-y-2 overflow-y-auto">
              {allowedUsers.length > 0 ? (
                allowedUsers.map((user) => (
                  <div
                    className="flex min-h-12 items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                    key={user.id}
                  >
                    <div className="min-w-0">
                      {user.username ? (
                        <p className="truncate font-medium text-sm">
                          @{user.username}
                        </p>
                      ) : null}
                      <code className="block truncate text-muted-foreground text-xs">
                        {user.id}
                      </code>
                    </div>
                    <Button
                      aria-label={`Remove Telegram user ID ${user.id}`}
                      disabled={saveMutation.isPending}
                      onClick={() => setRemoveTarget(user)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Delete02Icon aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-muted-foreground text-xs">
                  No users added.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TelegramUserImportDialog
        draft={importDraft}
        error={importError}
        onApply={handleImportApply}
        onDraftChange={(value) => {
          setImportDraft(value);
          setImportError(null);
        }}
        onOpenChange={setImportOpen}
        open={importOpen}
        pending={saveMutation.isPending}
      />

      <Dialog
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        open={removeTarget !== null}
      >
        <DialogContent className="gap-5 p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle>Remove Telegram user</DialogTitle>
            <DialogDescription>
              {removeTarget?.username
                ? `@${removeTarget.username} (${removeTarget.id})`
                : removeTarget?.id}{" "}
              loses access to this profile as soon as this is saved.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
            <Button
              onClick={() => setRemoveTarget(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={confirmRemoveAllowedUser}
              type="button"
              variant="destructive"
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TelegramUserImportDialog({
  draft,
  error,
  onApply,
  onDraftChange,
  onOpenChange,
  open,
  pending,
}: {
  draft: string;
  error: string | null;
  onApply: () => void;
  onDraftChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-5 p-6 sm:max-w-lg">
        <DialogHeader className="gap-2">
          <DialogTitle>Import Telegram user</DialogTitle>
          <DialogDescription>
            Paste raw Telegram update JSON. The sender ID and username will be
            added.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          className="max-h-48 font-mono text-sm"
          disabled={pending}
          onChange={(event) => {
            onDraftChange(event.target.value);
          }}
          placeholder={`{
  "message": {
    "from": {
      "id": 213193924,
      "username": "ahmadrosid"
    }
  }
}`}
          rows={10}
          value={draft}
        />

        {error ? (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending || !draft.trim()}
            onClick={onApply}
            type="button"
          >
            Add user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
