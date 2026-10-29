import type { ProfileSummary } from "@nakama/core";
import { type AgentGroup, groupRoster } from "@nakama/core/agent-groups";
import type { ImageAttachment } from "@nakama/core/contract";
import { MAX_IMAGE_BYTES, parseDataUrl } from "@nakama/core/message-content";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@nakama/ui";
import { Camera01Icon, Cancel01Icon } from "hugeicons-react";
import { useRef, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { groupAvatarUrl, useSaveGroup } from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { readFileAsDataUrl } from "@/lib/read-file-as-data-url";

const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/** Chips for the chosen agents and a search that adds more. */
function MemberPicker({
  memberIds,
  onAdd,
  onRemove,
  profiles,
}: {
  memberIds: string[];
  onAdd: (profileId: string) => void;
  onRemove: (profileId: string) => void;
  profiles: ProfileSummary[];
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const chosen = new Set(memberIds);
  const selected = groupRoster({ handles: {}, memberIds }, profiles).members;

  const matches = profiles.filter(
    (profile) =>
      !(profile.isSuper || chosen.has(profile.id)) &&
      profile.name.toLowerCase().includes(needle)
  );

  function add(profileId: string) {
    onAdd(profileId);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="font-semibold text-sm" htmlFor="group-agent-search">
        Add agents
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-input px-2 py-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20">
          {selected.map((profile) => (
            <span
              className="flex items-center gap-2 rounded-full bg-muted py-1 pr-2 pl-1"
              key={profile.id}
            >
              <ProfileAvatar profile={profile} size="xs" />
              <span className="text-sm">{profile.name}</span>
              <button
                aria-label={`Remove ${profile.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onRemove(profile.id)}
                type="button"
              >
                <Cancel01Icon className="size-3.5" />
              </button>
            </span>
          ))}
          <input
            className="min-w-24 flex-1 bg-transparent text-sm outline-none"
            id="group-agent-search"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();

                if (matches[0]) {
                  add(matches[0].id);
                }
              } else if (
                event.key === "Backspace" &&
                !search &&
                selected.length > 0
              ) {
                onRemove(selected.at(-1)?.id ?? "");
              }
            }}
            placeholder="Search agents"
            value={search}
          />
        </div>
        {matches.length > 0 ? (
          <>
            <span className="font-medium text-muted-foreground text-xs">
              Available agents
            </span>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl border border-input p-1.5 md:max-h-72">
              {matches.map((profile, index) => (
                <button
                  className={`flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted ${index === 0 ? "bg-muted" : ""}`}
                  key={profile.id}
                  onClick={() => add(profile.id)}
                  type="button"
                >
                  <ProfileAvatar profile={profile} size="sm" />
                  <span className="min-w-0 truncate text-sm">
                    {profile.name}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The photo thumbnail that opens the file picker. */
function PhotoPicker({
  hasImage,
  onChoose,
  src,
}: {
  hasImage: boolean;
  onChoose: (file: File | undefined) => void;
  src: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        aria-label={hasImage ? "Change photo" : "Add photo"}
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
        onClick={() => fileRef.current?.click()}
        type="button"
      >
        {src ? (
          <img alt="" className="size-full object-cover" src={src} />
        ) : (
          <Camera01Icon className="size-5" />
        )}
      </button>
      <input
        accept={IMAGE_TYPES}
        className="hidden"
        onChange={(event) => {
          onChoose(event.target.files?.[0]);
          event.target.value = "";
        }}
        ref={fileRef}
        type="file"
      />
    </>
  );
}

/** Whether the group has a photo once the pending change is applied. */
function hasGroupImage(
  image: ImageAttachment | null | undefined,
  group?: AgentGroup
): boolean {
  if (image !== undefined) {
    return image !== null;
  }

  return Boolean(group?.avatarVersion);
}

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
  const [brief, setBrief] = useState(group?.brief ?? "");
  const [memberIds, setMemberIds] = useState(group?.memberIds ?? []);
  const [image, setImage] = useState<ImageAttachment | null | undefined>();
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const hasImage = hasGroupImage(image, group);

  async function chooseImage(file: File | undefined) {
    if (!file) {
      return;
    }

    setImage(undefined);
    setPreview(null);

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Choose an image that is 5 MB or smaller.");

      return;
    }

    if (!IMAGE_TYPES.split(",").includes(file.type)) {
      setImageError("Choose a PNG, JPEG, GIF, or WebP image.");

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

  function addMember(profileId: string) {
    setMemberIds((current) => [...current, profileId]);
  }

  function removeMember(profileId: string) {
    setMemberIds((current) => current.filter((id) => id !== profileId));
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 md:grid-cols-2 md:gap-x-6"
          id="group-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (save.isPending) {
              return;
            }

            save.mutate(
              { brief: brief.trim(), image, memberIds, name: name.trim() },
              {
                onSuccess: (saved) => {
                  onSaved?.(saved);
                  onClose();
                },
              }
            );
          }}
        >
          <div className="flex min-w-0 flex-col gap-4 md:order-1">
            <div className="flex items-center gap-2 rounded-xl border border-input p-1.5">
              <PhotoPicker
                hasImage={hasImage}
                onChoose={(file) => void chooseImage(file)}
                src={
                  preview ?? (hasImage && group ? groupAvatarUrl(group) : null)
                }
              />
              <Input
                aria-label="Group name"
                autoFocus
                className="h-10 border-0 bg-transparent text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Group name"
                value={name}
              />
              {hasImage ? (
                <Button
                  onClick={() => {
                    setImage(group?.avatarVersion ? null : undefined);
                    setPreview(null);
                    setImageError(null);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {imageError ? (
              <p className="text-destructive text-sm" role="alert">
                {imageError}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-sm" htmlFor="group-brief">
                Brief
              </label>
              <Textarea
                className="max-h-64 min-h-32 overflow-y-auto"
                id="group-brief"
                maxLength={4000}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="What is this group for? Every agent reads it."
                rows={3}
                value={brief}
              />
            </div>
          </div>
          <div className="min-w-0 md:order-2">
            <MemberPicker
              memberIds={memberIds}
              onAdd={addMember}
              onRemove={removeMember}
              profiles={profiles}
            />
          </div>
          {save.error ? (
            <p
              className="text-destructive text-sm md:order-3 md:col-span-2"
              role="alert"
            >
              {formatError(save.error)}
            </p>
          ) : null}
          <DialogFooter className="md:order-4 md:col-span-2">
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
              {group ? "Save" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
