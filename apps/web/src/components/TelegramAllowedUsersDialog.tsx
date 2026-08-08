import { BracesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { useSaveTelegramSettings } from "@/hooks/use-telegram-settings";
import { formatError } from "@/lib/client";

export interface AllowedTelegramUser {
  id: string;
  username?: string;
}

function parseAllowedTelegramUsers(input: string): AllowedTelegramUser[] {
  const trimmed = input.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as {
        from?: { id?: unknown; username?: unknown };
        message?: { from?: { id?: unknown; username?: unknown } };
      };
      const user = payload.message?.from ?? payload.from;
      const id =
        typeof user?.id === "number"
          ? String(user.id)
          : String(user?.id ?? "").trim();
      const username =
        typeof user?.username === "string" ? user.username.trim() : "";

      if (!/^[1-9]\d*$/.test(id)) {
        throw new Error("Missing Telegram from.id.");
      }

      return [{ id, ...(username ? { username } : {}) }];
    } catch {
      throw new Error("Paste valid Telegram JSON or a numeric user ID.");
    }
  }

  return trimmed
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      if (!/^[1-9]\d*$/.test(id)) {
        throw new Error("Telegram user IDs must be positive numbers.");
      }

      return { id };
    });
}

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

  function saveAllowedUsers(
    nextUsers: AllowedTelegramUser[],
    afterSuccess?: () => void
  ) {
    onAllowedUsersChange(nextUsers);
    setFormError(null);

    saveMutation.mutate(
      {
        allowedUserIds: nextUsers.map((user) => user.id).join(","),
        profileId: profileId.trim() || "default",
      },
      {
        onError: (err) => {
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

  function removeAllowedUserId(id: string) {
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
                <BracesIcon aria-hidden />
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
                      onClick={() => removeAllowedUserId(user.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon aria-hidden="true" className="size-4" />
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

      <Dialog onOpenChange={setImportOpen} open={importOpen}>
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
            disabled={saveMutation.isPending}
            onChange={(event) => {
              setImportDraft(event.target.value);
              if (importError) {
                setImportError(null);
              }
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
            value={importDraft}
          />

          {importError ? (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
              role="alert"
            >
              {importError}
            </p>
          ) : null}

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
            <Button
              onClick={() => setImportOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={saveMutation.isPending || !importDraft.trim()}
              onClick={handleImportApply}
              type="button"
            >
              Add user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
