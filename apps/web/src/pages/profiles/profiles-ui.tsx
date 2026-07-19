import type { ProfileSummary } from "@nakama/core/contract";
import { PlusIcon, SearchIcon, UsersRoundIcon, XIcon, CameraIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  profileSidebarDescription,
  profilesTagline,
  sectionClass,
  type ProfileSaveStatus,
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
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      data-active={active || undefined}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
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
      <span className="font-medium text-amber-700 dark:text-amber-300">Name is required</span>
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

  return <p className="mt-2 text-xs text-muted-foreground">{content}</p>;
}

export function EditableProfileAvatar({
  profile,
  disabled,
  uploading,
  onPick,
  size = "md",
}: {
  profile: ProfileSummary;
  disabled: boolean;
  uploading: boolean;
  onPick: () => void;
  size?: "xs" | "sm" | "md" | "ml" | "lg";
}) {
  const overlayIconClass = size === "lg" ? "size-5" : "size-4";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label="Change profile image"
      className="group relative shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ProfileAvatar profile={profile} size={size} />
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {uploading ? (
          <Spinner className={cn(overlayIconClass, "text-primary-foreground")} />
        ) : (
          <CameraIcon className={cn(overlayIconClass, "text-primary-foreground")} aria-hidden />
        )}
      </span>
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
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
        disabled && "opacity-50",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <ProfileAvatar profile={profile} size="sm" />
      <span className="min-w-0 space-y-0.5">
        <span className="block truncate text-sm font-medium leading-tight">{profile.name}</span>
        <span className="block truncate text-xs leading-snug text-muted-foreground">
          {profileSidebarDescription(profile)}
        </span>
      </span>
    </button>
  );
}

export function ProfileSearch({
  value,
  disabled,
  isSearching,
  onChange,
  onClear,
}: {
  value: string;
  disabled: boolean;
  isSearching: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search…"
        disabled={disabled}
        className={cn("pl-9", isSearching && "pr-9")}
        aria-label="Search profiles"
      />
      {isSearching ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

const profileEmptySteps = [
  {
    title: "Create a profile",
    description: "Give it a name, avatar, and system prompt.",
  },
  {
    title: "Assign tools",
    description: "Control which capabilities this bot can use.",
  },
  {
    title: "Customize soul & knowledge",
    description: "Set voice, identity, and documents per profile.",
  },
] as const;

export function ProfilesEmptyState({
  variant,
  disabled,
  onCreate,
  onAskSuperBot,
}: {
  variant: "compact" | "full";
  disabled?: boolean;
  onCreate: () => void;
  onAskSuperBot?: () => void;
}) {
  const isCompact = variant === "compact";

  return (
    <div
      role="status"
      aria-labelledby="profiles-empty-title"
      className={cn(
        "text-center",
        isCompact
          ? "flex flex-col items-center gap-3 rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-6"
          : "flex min-h-[min(20rem,50dvh)] flex-col items-center justify-center gap-6 px-4 py-10 sm:px-6",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center border border-border bg-muted/40",
          isCompact ? "size-10 rounded-full" : "size-14 rounded-2xl",
        )}
      >
        <UsersRoundIcon
          className={cn("text-muted-foreground", isCompact ? "size-4" : "size-6")}
          aria-hidden
        />
      </div>

      <div className={cn("space-y-1.5", !isCompact && "max-w-sm")}>
        <p
          id="profiles-empty-title"
          className={cn(
            "font-medium text-foreground",
            isCompact ? "text-sm" : "type-section-title",
          )}
        >
          {isCompact ? "No profiles yet" : "Create your first profile"}
        </p>
        {!isCompact ? (
          <p className="type-body text-sm text-muted-foreground">{profilesTagline}</p>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button type="button" size={isCompact ? "sm" : "default"} disabled={disabled} onClick={onCreate}>
          <PlusIcon className="size-4" aria-hidden />
          {isCompact ? "Create profile" : "New profile"}
        </Button>
        {onAskSuperBot ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onAskSuperBot}
          >
            Ask Super Bot
          </Button>
        ) : null}
      </div>

      {!isCompact ? (
        <ol className="w-full max-w-md space-y-3 border-t border-border pt-6 text-left">
          {profileEmptySteps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground"
                aria-hidden
              >
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function EmptyMessage({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/60 px-3 py-8 text-center" role="status">
      <p className="type-body text-xs text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function PageState({ message, embedded = false }: { message: string; embedded?: boolean }) {
  return (
    <div
      className={cn(
        embedded
          ? "flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          : cn(
              sectionClass,
              "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
            ),
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
      <label className="text-xs text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
