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
import { cn } from "@nakama/ui/utils";
import { Camera01Icon, Cancel01Icon } from "hugeicons-react";
import { useRef, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { groupAvatarUrl, useSaveGroup } from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { readFileAsDataUrl } from "@/lib/read-file-as-data-url";

const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/** Show agent avatars in their own shape, not cut to a circle. */
const UNCLIPPED_AVATAR = "rounded-none outline-none";

/** Chips for the chosen agents in the search field, and every agent below it. */
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
    (profile) => !profile.isSuper && profile.name.toLowerCase().includes(needle)
  );

  function add(profileId: string) {
    onAdd(profileId);
    setSearch("");
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <label className="font-semibold text-sm" htmlFor="group-agent-search">
        Agents
      </label>
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-xl border border-input px-2 py-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20">
        {selected.map((profile) => (
          <span
            className="flex items-center gap-1.5 rounded-md bg-muted py-1 pr-2 pl-1"
            key={profile.id}
          >
            <ProfileAvatar
              className={UNCLIPPED_AVATAR}
              profile={profile}
              size="xs"
            />
            <span className="font-medium text-sm">{profile.name}</span>
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
          className="h-8 min-w-28 flex-1 bg-transparent px-1 text-sm outline-none"
          id="group-agent-search"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const next = matches.find((profile) => !chosen.has(profile.id));

              if (next) {
                add(next.id);
              }
            } else if (
              event.key === "Backspace" &&
              !search &&
              selected.length > 0
            ) {
              onRemove(selected.at(-1)?.id ?? "");
            }
          }}
          placeholder={selected.length > 0 ? "Add more" : "Search agents"}
          value={search}
        />
      </div>
      <div className="-mx-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {matches.map((profile) => {
          const added = chosen.has(profile.id);

          return (
            <button
              aria-pressed={added}
              className="flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-2 text-left hover:bg-muted"
              key={profile.id}
              onClick={() => (added ? onRemove(profile.id) : add(profile.id))}
              type="button"
            >
              <ProfileAvatar
                className={UNCLIPPED_AVATAR}
                profile={profile}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate font-medium text-sm">
                {profile.name}
              </span>
              <span
                className={cn(
                  "flex h-7 min-w-16 items-center justify-center rounded-full px-3 font-semibold text-xs",
                  added
                    ? "bg-primary text-primary-foreground"
                    : "border border-input bg-background"
                )}
              >
                {added ? "Added" : "Add"}
              </span>
            </button>
          );
        })}
        {needle && matches.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            No agents match "{search.trim()}"
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Where each stacked face sits in the preview (left, top, size), by face count. */
const FACE_SPOTS = [
  [],
  [[16, 16, 64]],
  [
    [4, 4, 52],
    [40, 40, 52],
  ],
  [
    [22, 0, 48],
    [0, 46, 48],
    [46, 46, 48],
  ],
  [
    [0, 0, 46],
    [50, 0, 46],
    [0, 50, 46],
    [50, 50, 46],
  ],
] as const;

/** How the group will look: photo or stacked faces, name, members, handles. */
function GroupPreview({
  handles,
  memberIds,
  name,
  photo,
  profiles,
}: {
  handles: AgentGroup["handles"];
  memberIds: string[];
  name: string;
  photo: string | null;
  profiles: ProfileSummary[];
}) {
  const roster = groupRoster({ handles, memberIds }, profiles);
  const { members } = roster;
  const faces = members.slice(0, 4);
  const spots = FACE_SPOTS[faces.length] ?? [];
  const extra = members.length - faces.length;
  const names = members.map((member) => member.name);

  let memberLine = "No agents yet";

  if (names.length > 3) {
    memberLine = `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  } else if (names.length > 0) {
    memberLine = names.join(", ");
  }

  return (
    <aside
      aria-label="Preview"
      className="flex flex-col items-center justify-center gap-3 border-l bg-muted px-6 py-10 text-center max-md:hidden"
    >
      {photo ? (
        <img alt="" className="size-24 rounded-2xl object-cover" src={photo} />
      ) : (
        <span className="relative block size-24">
          {faces.map((profile, index) => {
            const [left, top, size] = spots[index] ?? [0, 0, 0];

            return (
              <span
                className="absolute"
                key={profile.id}
                style={{ height: size, left, top, width: size }}
              >
                <ProfileAvatar
                  className={cn("size-full", UNCLIPPED_AVATAR)}
                  profile={profile}
                />
              </span>
            );
          })}
          {extra > 0 ? (
            <span className="absolute -right-1.5 -bottom-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-1.5 font-semibold text-primary-foreground text-xs ring-3 ring-muted">
              +{extra}
            </span>
          ) : null}
        </span>
      )}
      <p
        className={cn(
          "max-w-full truncate font-semibold text-xl",
          name.trim() ? "" : "text-muted-foreground"
        )}
      >
        {name.trim() || "Group name"}
      </p>
      <p className="text-muted-foreground text-sm">{memberLine}</p>
      {members.length > 0 ? (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {["all", ...members.map((member) => roster.handleOf(member.id))].map(
            (handle) => (
              <span
                className="rounded-full border bg-background px-2.5 py-1 font-medium text-xs"
                key={handle}
              >
                @{handle}
              </span>
            )
          )}
        </div>
      ) : null}
    </aside>
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

/** Photo, name and the photo's error, on one row. */
function NameRow({
  hasImage,
  imageError,
  name,
  onChoose,
  onNameChange,
  onRemovePhoto,
  photo,
}: {
  hasImage: boolean;
  imageError: string | null;
  name: string;
  onChoose: (file: File | undefined) => void;
  onNameChange: (name: string) => void;
  onRemovePhoto: () => void;
  photo: string | null;
}) {
  return (
    <>
      <div className="flex items-center gap-2 rounded-xl border border-input p-1.5">
        <PhotoPicker hasImage={hasImage} onChoose={onChoose} src={photo} />
        <Input
          aria-label="Group name"
          autoFocus
          className="h-10 border-0 bg-transparent text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          maxLength={80}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Group name"
          value={name}
        />
        {hasImage ? (
          <Button
            onClick={onRemovePhoto}
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
  const photo = preview ?? (hasImage && group ? groupAvatarUrl(group) : null);

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
      <DialogContent className="gap-0 p-0 sm:max-w-4xl md:grid-cols-[minmax(0,1fr)_20rem]">
        <form
          className="flex min-w-0 flex-col gap-4 p-4 sm:p-6 sm:pb-4"
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
          <DialogHeader>
            <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
          </DialogHeader>
          <NameRow
            hasImage={hasImage}
            imageError={imageError}
            name={name}
            onChoose={(file) => void chooseImage(file)}
            onNameChange={setName}
            onRemovePhoto={() => {
              setImage(group?.avatarVersion ? null : undefined);
              setPreview(null);
              setImageError(null);
            }}
            photo={photo}
          />
          <div className="flex flex-col gap-2">
            <label className="font-semibold text-sm" htmlFor="group-brief">
              Brief
            </label>
            <Textarea
              className="max-h-40 min-h-20 overflow-y-auto"
              id="group-brief"
              maxLength={4000}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="What is this group for? Every agent reads it."
              rows={3}
              value={brief}
            />
          </div>
          <MemberPicker
            memberIds={memberIds}
            onAdd={addMember}
            onRemove={removeMember}
            profiles={profiles}
          />
          {save.error ? (
            <p className="text-destructive text-sm" role="alert">
              {formatError(save.error)}
            </p>
          ) : null}
          <DialogFooter className="mt-auto bg-transparent sm:-mx-6 sm:-mb-4 sm:px-6 md:rounded-br-none">
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
        <GroupPreview
          handles={group?.handles ?? {}}
          memberIds={memberIds}
          name={name}
          photo={photo}
          profiles={profiles}
        />
      </DialogContent>
    </Dialog>
  );
}
