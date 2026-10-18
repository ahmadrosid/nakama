import type { ProfileSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  Add01Icon,
  Camera01Icon,
  Delete02Icon,
  DiceFaces05Icon,
  Undo02Icon,
  Upload04Icon,
  UserGroup02Icon,
} from "hugeicons-react";
import { type ReactNode, useState } from "react";
import { moodstoneIndexes, moodstoneSvg } from "@/components/moodstone";
import {
  moodstoneAvatars,
  moodstoneColors,
} from "@/components/moodstone-avatars";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  type ProfileSaveStatus,
  profilesTagline,
  sectionClass,
} from "@/pages/profiles/profiles-page.shared";

export function ProfileSaveIndicator({
  saveStatus,
  nameMissing,
  inline = false,
  leadingSeparator = true,
}: {
  saveStatus: ProfileSaveStatus;
  nameMissing: boolean;
  inline?: boolean;
  leadingSeparator?: boolean;
}) {
  let content: ReactNode = null;

  if (nameMissing) {
    content = (
      <span className="font-medium text-amber-700 dark:text-amber-300">
        Name is required
      </span>
    );
  } else if (saveStatus === "pending" || saveStatus === "saving") {
    content = (
      <span className="inline-flex items-center gap-1.5">
        <Spinner className="size-3" />
        Saving…
      </span>
    );
  } else if (saveStatus === "saved") {
    content = <span>Saved</span>;
  } else if (saveStatus === "error") {
    content = <span className="font-medium text-destructive">Save failed</span>;
  }

  if (!content) {
    return null;
  }

  if (inline) {
    return (
      <>
        {leadingSeparator ? <span aria-hidden>·</span> : null}
        <span role="status">{content}</span>
      </>
    );
  }

  return <p className="mt-2 text-muted-foreground text-xs">{content}</p>;
}

function ProfileAvatarOverlay({
  size,
  uploading,
}: {
  size: "xs" | "sm" | "md" | "ml" | "lg";
  uploading: boolean;
}) {
  const overlayIconClass = size === "lg" ? "size-5" : "size-4";

  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/50 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
      {uploading ? (
        <Spinner className={cn(overlayIconClass, "text-primary-foreground")} />
      ) : (
        <Camera01Icon
          aria-hidden
          className={cn(overlayIconClass, "text-primary-foreground")}
        />
      )}
    </span>
  );
}

export function EditableProfileAvatar({
  profile,
  disabled,
  uploading,
  onPick,
  onPreset,
  onRemove,
  size = "md",
  avatarClassName,
}: {
  avatarClassName?: string;
  profile: ProfileSummary;
  disabled: boolean;
  uploading: boolean;
  onPick: () => void;
  onPreset: (svg: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  size?: "xs" | "sm" | "md" | "ml" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const [colorIndex, setColorIndex] = useState(
    () => moodstoneIndexes(profile.id || profile.name || "?").colorIndex
  );

  const [previewAvatarIndex, setPreviewAvatarIndex] = useState<number | null>(
    null
  );

  return (
    <>
      <Popover
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          setPreviewAvatarIndex(null);
        }}
        open={open}
      >
        <PopoverTrigger
          aria-label="Change profile image"
          className="group relative shrink-0 rounded-full transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          <ProfileAvatar
            className={avatarClassName}
            profile={profile}
            size={size}
          />
          <ProfileAvatarOverlay size={size} uploading={uploading} />
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="flex w-68 min-w-0 flex-col gap-0.5 p-1.5"
        >
          <div
            className="relative mb-1 flex h-33 items-center justify-center rounded-lg transition-colors duration-150 ease-out"
            style={{ backgroundColor: `${moodstoneColors[colorIndex].lit}4d` }}
          >
            {previewAvatarIndex === null ? (
              <ProfileAvatar
                active
                className="size-20 rounded-none outline-none"
                profile={profile}
                size="lg"
              />
            ) : (
              <img
                alt="Avatar preview"
                className="size-20"
                height={80}
                src={`data:image/svg+xml,${encodeURIComponent(
                  moodstoneSvg(
                    previewAvatarIndex,
                    colorIndex,
                    !window.matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                  )
                )}`}
                width={80}
              />
            )}
            {previewAvatarIndex === null ? null : (
              <Button
                aria-label="Undo"
                className="absolute top-2 left-2 bg-background/85 shadow-xs"
                onClick={() => setPreviewAvatarIndex(null)}
                size="icon"
                variant="ghost"
              >
                <Undo02Icon aria-hidden />
              </Button>
            )}
            <Button
              aria-label="Shuffle"
              className="absolute top-2 right-2 bg-background/85 shadow-xs"
              onClick={() => {
                setPreviewAvatarIndex(
                  Math.floor(Math.random() * moodstoneAvatars.length)
                );
                setColorIndex(
                  Math.floor(Math.random() * moodstoneColors.length)
                );
              }}
              size="icon"
              variant="ghost"
            >
              <DiceFaces05Icon aria-hidden />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 px-1.5 pt-0.5 pb-1">
            {moodstoneAvatars.map((avatar, avatarIndex) => (
              <button
                aria-label={`Preview ${avatar.cut} avatar`}
                aria-pressed={avatarIndex === previewAvatarIndex}
                className={cn(
                  "flex h-9 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  avatarIndex === previewAvatarIndex &&
                    "bg-muted ring-[1.5px] ring-foreground ring-inset"
                )}
                key={avatar.cut}
                onClick={() => setPreviewAvatarIndex(avatarIndex)}
                type="button"
              >
                <img
                  alt=""
                  className="size-7"
                  height={28}
                  src={`data:image/svg+xml,${encodeURIComponent(
                    moodstoneSvg(avatarIndex, colorIndex)
                  )}`}
                  width={28}
                />
              </button>
            ))}
          </div>
          <div className="grid grid-cols-12 justify-items-center gap-0.5 px-2 pt-1 pb-2">
            {moodstoneColors.map((color, index) => (
              <button
                aria-label={`${color.name} color`}
                aria-pressed={index === colorIndex}
                className={cn(
                  "size-4 cursor-pointer rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                  index === colorIndex && "outline-2 outline-foreground"
                )}
                key={color.name}
                onClick={() => setColorIndex(index)}
                style={{
                  background: `linear-gradient(135deg, ${color.lit}, ${color.shade})`,
                }}
                type="button"
              />
            ))}
          </div>
          {previewAvatarIndex === null ? null : (
            <Button
              className="mb-1"
              onClick={() => {
                setPreviewAvatarIndex(null);
                setOpen(false);
                void onPreset(moodstoneSvg(previewAvatarIndex, colorIndex));
              }}
              size="lg"
            >
              Apply
            </Button>
          )}
          <div className="-mx-1.5 my-0.5 h-px bg-border" />
          <Button
            className="justify-start gap-2.5 font-normal"
            onClick={() => {
              setOpen(false);
              onPick();
            }}
            size="lg"
            variant="ghost"
          >
            <Upload04Icon aria-hidden className="text-muted-foreground" />
            Upload image…
          </Button>
          {profile.hasAvatar && onRemove ? (
            <Button
              className="justify-start gap-2.5 font-normal text-destructive hover:text-destructive"
              onClick={() => {
                setOpen(false);
                setRemoveOpen(true);
              }}
              size="lg"
              variant="ghost"
            >
              <Delete02Icon aria-hidden />
              Remove image
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      {removeOpen && onRemove ? (
        <ConfirmDialog
          confirmLabel="Remove"
          description={`Remove the profile image for "${profile.name}"?`}
          onClose={() => setRemoveOpen(false)}
          onConfirm={onRemove}
          title="Remove profile image?"
        />
      ) : null}
    </>
  );
}

const profileEmptySteps = [
  {
    description: "Give it a name, avatar, and system prompt.",
    title: "Create a profile",
  },
  {
    description: "Control which capabilities this bot can use.",
    title: "Assign tools",
  },
  {
    description: "Set voice, identity, and documents per profile.",
    title: "Customize soul & knowledge",
  },
] as const;

export function ProfilesEmptyState({
  disabled,
  canCreate = true,
  canImport = false,
  onCreate,
  onImport,
  onAskSuperNakama,
}: {
  disabled?: boolean;
  canCreate?: boolean;
  canImport?: boolean;
  onCreate: () => void;
  onImport?: () => void;
  onAskSuperNakama?: () => void;
}) {
  const importIsPrimary = canImport && !canCreate;

  return (
    <div
      aria-labelledby="profiles-empty-title"
      className="flex min-h-[min(20rem,50dvh)] flex-col items-center justify-center gap-6 px-4 py-10 text-center sm:px-6"
      role="status"
    >
      <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40">
        <UserGroup02Icon aria-hidden className="size-6 text-muted-foreground" />
      </div>

      <div className="max-w-sm space-y-1.5">
        <p
          className="type-section-title font-medium text-foreground"
          id="profiles-empty-title"
        >
          {importIsPrimary ? "Import a profile" : "Create your first profile"}
        </p>
        <p className="type-body text-muted-foreground text-sm">
          {profilesTagline}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        {canCreate ? (
          <Button disabled={disabled} onClick={onCreate} type="button">
            <Add01Icon aria-hidden className="size-4" />
            New profile
          </Button>
        ) : null}
        {canImport && onImport ? (
          <Button
            disabled={disabled}
            onClick={onImport}
            type="button"
            variant={importIsPrimary ? "default" : "outline"}
          >
            <Upload04Icon aria-hidden className="size-4" />
            Import profile
          </Button>
        ) : null}
        {onAskSuperNakama ? (
          <Button
            disabled={disabled}
            onClick={onAskSuperNakama}
            size="sm"
            type="button"
            variant="ghost"
          >
            Ask Super Nakama
          </Button>
        ) : null}
      </div>

      <ol className="w-full max-w-md space-y-3 border-border border-t pt-6 text-left">
        {profileEmptySteps.map((step, index) => (
          <li className="flex gap-3" key={step.title}>
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs tabular-nums"
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-medium text-foreground text-sm">
                {step.title}
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PageState({
  message,
  embedded = false,
}: {
  message: string;
  embedded?: boolean;
}) {
  return (
    <div
      className={cn(
        embedded
          ? "flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground text-sm"
          : cn(
              sectionClass,
              "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-muted-foreground text-sm"
            )
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
