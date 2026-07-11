import { useState } from "react";
import { Trash2Icon } from "lucide-react";
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
      setLocalError(error instanceof Error ? error.message : "Invalid user ID.");
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
        onSuccess: () => {
          onSaved?.();
          onOpenChange(false);
        },
        onError: (error) => {
          const message = formatError(error);
          setLocalError(message);
          onError?.(message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              placeholder="User ID or comma-separated IDs"
              value={newUserId}
              onChange={(event) => setNewUserId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAdd();
                }
              }}
            />
          </InputGroup>
          <Button type="button" size="sm" variant="outline" onClick={handleAdd}>
            Add
          </Button>

          {allowedUsers.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {allowedUsers.map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <code className="text-xs">{user.id}</code>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${user.id}`}
                    onClick={() => handleRemove(user.id)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No manual users yet.</p>
          )}

          {localError ? (
            <p className="text-xs text-destructive" role="alert">
              {localError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saveMutation.isPending} onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
