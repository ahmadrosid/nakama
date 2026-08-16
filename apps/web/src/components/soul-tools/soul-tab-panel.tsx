import type {
  ProfileSummary,
  SoulFileStatus,
  SoulStackFiles,
} from "@nakama/core/contract";
import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  CircleIcon,
  File01Icon,
  Folder01Icon,
  RefreshIcon,
} from "hugeicons-react";
import type { ReactNode } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { SOUL_FILES } from "@/components/soul-tools/soul-files";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

export function SoulTabPanel({
  embedded,
  selectedProfile,
  status,
  presentCount,
  busy,
  refreshing,
  onRefresh,
  onOpenFile,
}: {
  embedded: boolean;
  selectedProfile: ProfileSummary | null;
  status: { directory: string; files: SoulFileStatus } | null;
  presentCount: number;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenFile: (fileKey: keyof SoulStackFiles) => void;
}) {
  return (
    <div className={embedded ? undefined : "min-w-0 p-4 sm:p-5"}>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {embedded ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="type-section-title">
                {selectedProfile?.name ?? "Profile prompt"}
              </h2>
              {selectedProfile?.soulActive ? (
                <span className="scope-badge scope-badge-active">active</span>
              ) : null}
            </div>
          )}
          <p className={cn("type-body text-xs", !embedded && "mt-1")}>
            Profile prompt · one stack per bot
          </p>
          {status ? (
            <p
              className="type-code mt-2 truncate text-muted-foreground"
              title={status.directory}
            >
              {status.directory}
            </p>
          ) : null}
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            !embedded && "hidden lg:flex"
          )}
        >
          <Button
            disabled={busy || refreshing}
            onClick={onRefresh}
            size="sm"
            type="button"
            variant="outline"
          >
            {refreshing ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshIcon aria-hidden className="size-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs tabular-nums">
          {status
            ? `${presentCount} of ${SOUL_FILES.length} files present`
            : "Checking files…"}
        </p>
        <p className="text-muted-foreground text-xs lg:hidden">
          Tap a file to view or edit
        </p>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {SOUL_FILES.map((file) => (
          <FileStatusListItem
            description={file.description}
            key={file.key}
            label={file.label}
            onClick={() => onOpenFile(file.key)}
            present={status?.files[file.key] ?? false}
            writable={file.writable}
          />
        ))}
      </ul>

      {embedded ? null : (
        <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
          <p className="font-medium text-foreground">How it works</p>
          <p className="mt-2">
            Prompt files shape the agent&apos;s identity and voice. Start a new
            chat session after editing so changes take effect.
          </p>
        </div>
      )}
    </div>
  );
}

export function SoulTabShell({
  profiles,
  profileId,
  busy,
  refreshing,
  panel,
  onProfileSelect,
  onRefresh,
}: {
  profiles: ProfileSummary[];
  profileId: string | null;
  busy: boolean;
  refreshing: boolean;
  panel: ReactNode;
  onProfileSelect: (profileId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className={cn(sectionClass, "overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-3 border-border border-b p-4 lg:hidden">
        <Select
          disabled={busy || refreshing || !profileId}
          onValueChange={(value) => {
            if (value) {
              onProfileSelect(String(value));
            }
          }}
          value={profileId ?? undefined}
        >
          <SelectTrigger aria-label="Profile" className="min-w-0 flex-1">
            <SelectValue placeholder="Select profile">
              {profiles.find((profile) => profile.id === profileId)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                <span className="flex items-center gap-2">
                  <ProfileAvatar profile={profile} size="sm" />
                  <span>{profile.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="Refresh soul stack"
            disabled={busy || refreshing}
            onClick={onRefresh}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {refreshing ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshIcon aria-hidden className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-border border-b p-4 lg:block lg:border-r lg:border-b-0">
          <div className="mb-4">
            <h2 className="type-section-title">Profiles</h2>
            <p className="type-body mt-1 text-xs">
              Each profile has its own soul stack under ~/.nakama/profiles/.
            </p>
          </div>

          <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 lg:max-h-none">
            {profiles.map((profile) => (
              <ScopeButton
                active={profile.id === profileId}
                activeLabel={profile.soulActive ? "active" : undefined}
                key={profile.id}
                leading={<ProfileAvatar profile={profile} size="sm" />}
                onClick={() => onProfileSelect(profile.id)}
                subtitle={profile.soulActive ? "soul active" : "soul inactive"}
                title={profile.name}
              />
            ))}
          </div>
        </aside>

        {panel}
      </div>
    </section>
  );
}

function ScopeButton({
  active,
  title,
  subtitle,
  activeLabel,
  leading,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  activeLabel?: string;
  leading?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="scope-item"
      data-active={active || undefined}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "truncate font-medium text-sm",
                active ? "text-primary" : "text-foreground"
              )}
            >
              {title}
            </p>
            {activeLabel ? (
              <span className="scope-badge scope-badge-active">
                {activeLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
            {subtitle}
          </p>
        </div>
      </div>
    </button>
  );
}

function FileStatusListItem({
  label,
  description,
  writable,
  present,
  onClick,
}: {
  label: string;
  description: string;
  writable: boolean;
  present: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        className={cn(
          "group flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition",
          "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          present && "bg-emerald-50/40 dark:bg-emerald-950/10"
        )}
        onClick={onClick}
        type="button"
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background",
            present
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-muted-foreground"
          )}
        >
          {writable ? (
            <File01Icon aria-hidden className="size-4" />
          ) : (
            <Folder01Icon aria-hidden className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-foreground text-sm">{label}</p>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
            {description}
          </p>
        </div>

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
            present
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-muted text-muted-foreground"
          )}
        >
          {present ? (
            <CheckmarkCircle01Icon className="size-3.5" />
          ) : (
            <CircleIcon className="size-3.5" />
          )}
          {present ? "Present" : "Missing"}
        </span>

        <ArrowRight01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition group-hover:text-muted-foreground"
        />
      </button>
    </li>
  );
}

export function SoulTabPageState({
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
