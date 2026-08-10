import { Delete02Icon } from "hugeicons-react";
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
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { useSaveDiscordSettings } from "@/hooks/use-discord-settings";
import { formatError } from "@/lib/client";

export interface AllowedDiscordUser {
  id: string;
}

function parseDiscordUserIds(input: string): AllowedDiscordUser[] {
  const trimmed = input.trim();

  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      if (!/^\d{17,20}$/.test(id)) {
        throw new Error("Discord user IDs must be 17–20 digit snowflakes.");
      }

      return { id };
    });
}

export function DiscordAllowedUsersDialog({
  open,
  onOpenChange,
  allowedUsers,
  onAllowedUsersChange,
  profileId,
  onSaved,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedUsers: AllowedDiscordUser[];
  onAllowedUsersChange: (users: AllowedDiscordUser[]) => void;
  profileId: string;
  onSaved?: () => void;
  onError?: (message: string) => void;
}) {
  const saveMutation = useSaveDiscordSettings();
  const [newUserId, setNewUserId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleAdd() {
    setLocalError(null);

    try {
      const parsed = parseDiscordUserIds(newUserId);
      if (parsed.length === 0) {
        return;
      }

      const existing = new Set(allowedUsers.map((user) => user.id));
      const next = [...allowedUsers];

      for (const user of parsed) {
        if (!existing.has(user.id)) {
          next.push(user);
          existing.add(user.id);
        }
      }

      onAllowedUsersChange(next);
      setNewUserId("");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Invalid user ID."
      );
    }
  }

  function handleRemove(id: string) {
    onAllowedUsersChange(allowedUsers.filter((user) => user.id !== id));
  }

  function handleSave() {
    setLocalError(null);

    saveMutation.mutate(
      {
        allowedUserIds: allowedUsers.map((user) => user.id).join(","),
        profileId: profileId.trim() || "default",
      },
      {
        onError: (error) => {
          const message = formatError(error);
          setLocalError(message);
          onError?.(message);
        },
        onSuccess: () => {
          onSaved?.();
          onOpenChange(false);
        },
      }
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allowed Discord users</DialogTitle>
          <DialogDescription>
            Add Discord user snowflake IDs that may use the bot without pairing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <InputGroup>
            <InputGroupInput
              onChange={(event) => setNewUserId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="User ID or comma-separated IDs"
              value={newUserId}
            />
          </InputGroup>
          <Button onClick={handleAdd} size="sm" type="button" variant="outline">
            Add
          </Button>

          {allowedUsers.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {allowedUsers.map((user) => (
                <li
                  className="flex items-center justify-between gap-2 px-3 py-2"
                  key={user.id}
                >
                  <code className="text-xs">{user.id}</code>
                  <Button
                    aria-label={`Remove ${user.id}`}
                    onClick={() => handleRemove(user.id)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Delete02Icon className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              No manual users yet.
            </p>
          )}

          {localError ? (
            <p className="text-destructive text-xs" role="alert">
              {localError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={saveMutation.isPending}
            onClick={handleSave}
            type="button"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
