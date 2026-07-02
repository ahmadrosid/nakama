import { useState } from "react";
import { BracesIcon, Trash2Icon } from "lucide-react";
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
      const id = typeof user?.id === "number" ? String(user.id) : String(user?.id ?? "").trim();
      const username = typeof user?.username === "string" ? user.username.trim() : "";

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedUsers: AllowedTelegramUser[];
  onAllowedUsersChange: (users: AllowedTelegramUser[]) => void;
  profileId: string;
  onSaved?: () => void;
  onError?: (message: string) => void;
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

  function saveAllowedUsers(nextUsers: AllowedTelegramUser[], afterSuccess?: () => void) {
    onAllowedUsersChange(nextUsers);
    setFormError(null);

    saveMutation.mutate(
      {
        allowedUserIds: nextUsers.map((user) => user.id).join(","),
        profileId: profileId.trim() || "default",
      },
      {
        onSuccess: () => {
          onSaved?.();
          afterSuccess?.();
        },
        onError: (err) => {
          const message = formatError(err);
          setFormError(message);
          onError?.(message);
        },
      },
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle>Telegram Users</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Add user ID</p>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={saveMutation.isPending}
                className="text-muted-foreground hover:text-foreground"
                onClick={openImportDialog}
              >
                <BracesIcon aria-hidden />
                Import JSON
              </Button>
            </div>
            <InputGroup>
              <InputGroupInput
                value={newAllowedUserInput}
                disabled={saveMutation.isPending}
                className="font-mono text-sm ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder="213193924"
                onChange={(event) => {
                  setNewAllowedUserInput(event.target.value);
                  if (formError) {
                    setFormError(null);
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saveMutation.isPending || !newAllowedUserInput.trim()}
                  onClick={addAllowedUserId}
                >
                  Add user
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {formError ? (
              <div className="">
                <p
                  className="rounded-md bg-destructive/10 px-2.5 py-1 text-xs text-destructive"
                  role="alert"
                >
                  {formError}
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Users</p>

            <div className="h-40 space-y-2 overflow-y-auto">
              {allowedUsers.length > 0 ? (
                allowedUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      {user.username ? (
                        <p className="truncate text-sm font-medium">@{user.username}</p>
                      ) : null}
                      <code className="block truncate text-xs text-muted-foreground">
                        {user.id}
                      </code>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={saveMutation.isPending}
                      aria-label={`Remove Telegram user ID ${user.id}`}
                      onClick={() => removeAllowedUserId(user.id)}
                    >
                      <Trash2Icon className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No users added.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="gap-5 p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle>Import Telegram user</DialogTitle>
            <DialogDescription>
              Paste raw Telegram update JSON. The sender ID and username will be added.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={importDraft}
            disabled={saveMutation.isPending}
            autoFocus
            rows={10}
            className="font-mono text-sm max-h-48"
            placeholder={`{
  "message": {
    "from": {
      "id": 213193924,
      "username": "ahmadrosid"
    }
  }
}`}
            onChange={(event) => {
              setImportDraft(event.target.value);
              if (importError) {
                setImportError(null);
              }
            }}
          />

          {importError ? (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              role="alert"
            >
              {importError}
            </p>
          ) : null}

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saveMutation.isPending || !importDraft.trim()}
              onClick={handleImportApply}
            >
              Add user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
