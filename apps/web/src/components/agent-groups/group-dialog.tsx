import type { AgentGroup } from "@nakama/core/agent-groups";
import type { ImageAttachment } from "@nakama/core/contract";
import { parseDataUrl } from "@nakama/core/message-content";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@nakama/ui";
import { useRef, useState } from "react";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useSaveGroup } from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { readFileAsDataUrl } from "@/lib/read-file-as-data-url";

const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/** Creates a group, or edits `group`: photo, name, and members in one place. */
export function GroupDialog({
  group,
  onClose,
  onSaved,
}: {
  group?: AgentGroup;
  onClose: () => void;
  onSaved?: (group: AgentGroup) => void;
}) {
  const { data: profiles = [] } = useProfilesQuery();
  const save = useSaveGroup(group?.id);
  const [name, setName] = useState(group?.name ?? "");
  const [memberIds, setMemberIds] = useState(group?.memberIds ?? []);
  const [image, setImage] = useState<ImageAttachment | null | undefined>();
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const choices = profiles.filter((profile) => !profile.isSuper);

  const hasImage = image
    ? true
    : image === null
      ? false
      : Boolean(group?.avatarVersion);

  async function chooseImage(file: File | undefined) {
    if (!file) {
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    const parsed = parseDataUrl(dataUrl);

    if (!parsed) {
      setImageError("Choose a PNG, JPEG, GIF, or WebP image.");

      return;
    }

    setImageError(null);
    setImage(parsed);
    setPreview(dataUrl);
  }

  function toggle(profileId: string, checked: boolean) {
    setMemberIds((current) =>
      checked
        ? [...current, profileId]
        : current.filter((id) => id !== profileId)
    );
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          id="group-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(
              { image, memberIds, name: name.trim() },
              {
                onSuccess: (saved) => {
                  onSaved?.(saved);
                  onClose();
                },
              }
            );
          }}
        >
          <div className="flex items-center gap-3">
            {preview ? (
              <img
                alt=""
                className="size-14 shrink-0 rounded-xl object-cover"
                src={preview}
              />
            ) : (
              <GroupAvatar
                className="size-14 rounded-xl"
                group={{
                  avatarVersion:
                    image === null ? null : (group?.avatarVersion ?? null),
                  createdAt: group?.createdAt ?? "",
                  id: group?.id ?? "new",
                  memberIds,
                  name,
                }}
                profiles={profiles}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => fileRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {hasImage ? "Change photo" : "Add photo"}
              </Button>
              {hasImage ? (
                <Button
                  onClick={() => {
                    setImage(group?.avatarVersion ? null : undefined);
                    setPreview(null);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <input
              accept={IMAGE_TYPES}
              className="hidden"
              onChange={(event) => {
                void chooseImage(event.target.files?.[0]);
                event.target.value = "";
              }}
              ref={fileRef}
              type="file"
            />
          </div>
          {imageError ? (
            <p className="text-destructive text-sm" role="alert">
              {imageError}
            </p>
          ) : null}
          <Input
            aria-label="Group name"
            autoFocus
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Group name"
            value={name}
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {choices.map((profile) => (
              <label
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50"
                key={profile.id}
              >
                <Checkbox
                  checked={memberIds.includes(profile.id)}
                  onCheckedChange={(checked) => toggle(profile.id, checked)}
                />
                <ProfileAvatar profile={profile} size="sm" />
                <span className="min-w-0 truncate text-sm">{profile.name}</span>
              </label>
            ))}
          </div>
          {save.error ? (
            <p className="text-destructive text-sm" role="alert">
              {formatError(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                save.isPending ||
                !name.trim() ||
                memberIds.length < 2 ||
                memberIds.length > 12
              }
              type="submit"
            >
              {group ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
