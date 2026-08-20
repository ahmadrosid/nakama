import type { ProfileSummary } from "@nakama/core/contract";
import {
  Add01Icon,
  Camera01Icon,
  Delete02Icon,
  UserGroup02Icon,
} from "hugeicons-react";
import type { ReactNode } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  type ProfileSaveStatus,
  profilesTagline,
  sectionClass,
} from "@/pages/profiles/profiles-page.shared";

export function ProfileDetailTabButton({
  id,
  active,
  controls,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  controls: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-controls={controls}
      aria-selected={active}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 font-medium text-sm transition-colors sm:gap-2 sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
      data-active={active || undefined}
      id={id}
      onClick={onSelect}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

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
  onRemove,
  size = "md",
}: {
  profile: ProfileSummary;
  disabled: boolean;
  uploading: boolean;
  onPick: () => void;
  onRemove?: () => void;
  size?: "xs" | "sm" | "md" | "ml" | "lg";
}) {
  const triggerClassName =
    "group relative shrink-0 rounded-full transition-transform duration-150 ease-out active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  if (profile.hasAvatar && onRemove) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              aria-label="Change or remove profile image"
              className={triggerClassName}
              disabled={disabled}
              type="button"
            />
          }
        >
          <ProfileAvatar profile={profile} size={size} />
          <ProfileAvatarOverlay size={size} uploading={uploading} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuItem className="cursor-pointer" onClick={onPick}>
            <Camera01Icon aria-hidden className="size-4" />
            Change image
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={onRemove}
            variant="destructive"
          >
            <Delete02Icon aria-hidden className="size-4" />
            Remove image
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <button
      aria-label="Change profile image"
      className={triggerClassName}
      disabled={disabled}
      onClick={onPick}
      type="button"
    >
      <ProfileAvatar profile={profile} size={size} />
      <ProfileAvatarOverlay size={size} uploading={uploading} />
    </button>
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
  onCreate,
  onAskSuperBot,
}: {
  disabled?: boolean;
  canCreate?: boolean;
  onCreate: () => void;
  onAskSuperBot?: () => void;
}) {
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
          Create your first profile
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
        {onAskSuperBot ? (
          <Button
            disabled={disabled}
            onClick={onAskSuperBot}
            size="sm"
            type="button"
            variant="ghost"
          >
            Ask Super Bot
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

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-muted-foreground text-xs" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
