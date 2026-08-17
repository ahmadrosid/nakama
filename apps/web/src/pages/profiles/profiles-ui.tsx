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
  profileSidebarDescription,
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

export function ProfileScopeButton({
  profile,
  active,
  disabled,
  onClick,
}: {
  profile: ProfileSummary;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
        disabled && "opacity-50",
        active
          ? "bg-primary/5 text-foreground dark:bg-primary/10"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <ProfileAvatar active={active} profile={profile} size="sm" />
      <span className="min-w-0 space-y-0.5">
        <span className="block truncate font-medium text-sm leading-tight">
          {profile.name}
        </span>
        <span className="block truncate text-muted-foreground text-xs leading-snug">
          {profileSidebarDescription(profile)}
        </span>
      </span>
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
  variant,
  disabled,
  canCreate = true,
  onCreate,
  onAskSuperBot,
}: {
  variant: "compact" | "full";
  disabled?: boolean;
  canCreate?: boolean;
  onCreate: () => void;
  onAskSuperBot?: () => void;
}) {
  const isCompact = variant === "compact";

  return (
    <div
      aria-labelledby="profiles-empty-title"
      className={cn(
        "text-center",
        isCompact
          ? "flex flex-col items-center gap-3 rounded-md border border-border/80 border-dashed bg-muted/20 px-3 py-6"
          : "flex min-h-[min(20rem,50dvh)] flex-col items-center justify-center gap-6 px-4 py-10 sm:px-6"
      )}
      role="status"
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center border border-border bg-muted/40",
          isCompact ? "size-10 rounded-full" : "size-14 rounded-2xl"
        )}
      >
        <UserGroup02Icon
          aria-hidden
          className={cn(
            "text-muted-foreground",
            isCompact ? "size-4" : "size-6"
          )}
        />
      </div>

      <div className={cn("space-y-1.5", !isCompact && "max-w-sm")}>
        <p
          className={cn(
            "font-medium text-foreground",
            isCompact ? "text-sm" : "type-section-title"
          )}
          id="profiles-empty-title"
        >
          {isCompact ? "No profiles yet" : "Create your first profile"}
        </p>
        {isCompact ? null : (
          <p className="type-body text-muted-foreground text-sm">
            {profilesTagline}
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        {canCreate ? (
          <Button
            disabled={disabled}
            onClick={onCreate}
            size={isCompact ? "sm" : "default"}
            type="button"
          >
            <Add01Icon aria-hidden className="size-4" />
            {isCompact ? "Create profile" : "New profile"}
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

      {isCompact ? null : (
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
      )}
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
