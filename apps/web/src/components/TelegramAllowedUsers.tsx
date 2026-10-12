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
import { Add01Icon, Delete02Icon } from "hugeicons-react";
import { useState } from "react";
import {
  useSaveTelegramSettings,
  useTelegramAccessRequests,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  type AllowedTelegramUser,
  parseAllowedTelegramUsers,
} from "@/lib/parse-allowed-telegram-users";

interface TelegramAllowedUsersProps {
  allowedUsers: AllowedTelegramUser[];
  onAllowedUsersChange: (users: AllowedTelegramUser[]) => void;
  onError?: (message: string) => void;
  onSaved?: () => void;
  profileId: string;
}

export function TelegramAllowedUsers({
  allowedUsers,
  onAllowedUsersChange,
  profileId,
  onSaved,
  onError,
}: TelegramAllowedUsersProps) {
  const saveMutation = useSaveTelegramSettings();
  const { data: access } = useTelegramAccessRequests();

  const [newAllowedUserInput, setNewAllowedUserInput] = useState("");
  const [addOpen, setAddOpen] = useState(false);
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

  function confirmRemoveAllowedUser() {
    if (!removeTarget) {
      return;
    }

    const id = removeTarget.id;
    // Closed before the save resolves on purpose: a failed save rolls the list
    // back and renders its error on the page, which nobody can read through an
    // open confirm.
    setRemoveTarget(null);
    saveAllowedUsers(allowedUsers.filter((entry) => entry.id !== id));
  }

  function displayName(user: AllowedTelegramUser): string {
    const username = user.username ?? access?.allowedUsernames?.[user.id];

    return username ? `@${username}` : "Telegram user";
  }

  return (
    <>
      <div className="divide-y divide-border">
        <h3 className="px-4 py-3 font-medium text-sm">
          People with access{" "}
          <span className="font-normal text-muted-foreground">
            {allowedUsers.length}
          </span>
        </h3>
        {allowedUsers.map((user) => (
          <div
            className="flex items-center justify-between gap-3 px-4 py-3"
            key={user.id}
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{displayName(user)}</p>
              <p className="truncate text-muted-foreground text-xs">
                ID {user.id}
              </p>
            </div>
            <Button
              aria-label={`Remove ${displayName(user)}`}
              disabled={saveMutation.isPending}
              onClick={() => setRemoveTarget(user)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Delete02Icon aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}
        <div className="px-4 py-3 text-sm">
          <Button
            aria-expanded={addOpen}
            onClick={() => setAddOpen((open) => !open)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Add01Icon aria-hidden className="size-4" />
            Add by Telegram ID
          </Button>
          {addOpen ? (
            <div className="mt-3">
              <InputGroup>
                <InputGroupInput
                  aria-label="Telegram ID"
                  className="font-mono text-sm"
                  disabled={saveMutation.isPending}
                  onChange={(event) => {
                    setNewAllowedUserInput(event.target.value);

                    if (formError) {
                      setFormError(null);
                    }
                  }}
                  placeholder="e.g. 213193924"
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
                    Add
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <p className="mt-2 text-muted-foreground text-xs">
                To find an ID, message{" "}
                <a
                  className="font-medium text-primary hover:underline"
                  href="https://t.me/userinfobot"
                  rel="noreferrer"
                  target="_blank"
                >
                  @userinfobot
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                in Telegram.
              </p>
              {formError ? (
                <p
                  className="mt-2 rounded-md bg-destructive/10 px-2.5 py-1 text-destructive text-xs"
                  role="alert"
                >
                  {formError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        open={removeTarget !== null}
      >
        <DialogContent className="gap-5 p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle>Remove access?</DialogTitle>
            <DialogDescription>
              {removeTarget ? displayName(removeTarget) : null} will no longer
              be able to message this agent.
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
