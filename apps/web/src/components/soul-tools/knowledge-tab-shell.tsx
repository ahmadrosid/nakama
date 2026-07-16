import type { ProfileSummary } from "@nakama/core/contract";
import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
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

export function KnowledgeTabShell({
  profiles,
  profileId,
  selectedProfileName,
  busy,
  refreshing,
  panel,
  onProfileSelect,
  onRefresh,
}: {
  profiles: ProfileSummary[];
  profileId: string | null;
  selectedProfileName?: string;
  busy: boolean;
  refreshing: boolean;
  panel: ReactNode;
  onProfileSelect: (profileId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className={cn(sectionClass, "overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:hidden">
        <Select
          value={profileId ?? undefined}
          disabled={busy || refreshing || !profileId}
          onValueChange={(value) => {
            if (value) {
              onProfileSelect(String(value));
            }
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" aria-label="Profile">
            <SelectValue placeholder="Select profile">{selectedProfileName}</SelectValue>
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
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy || refreshing}
            aria-label="Refresh knowledge base"
            onClick={onRefresh}
          >
            {refreshing ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCwIcon className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-b border-border p-4 lg:block lg:border-r lg:border-b-0">
          <h2 className="type-section-title mb-4">Profiles</h2>

          <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 lg:max-h-none">
            {profiles.map((profile) => (
              <ScopeButton
                key={profile.id}
                active={profile.id === profileId}
                title={profile.name}
                leading={<ProfileAvatar profile={profile} size="sm" />}
                onClick={() => onProfileSelect(profile.id)}
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
  leading,
  onClick,
}: {
  active: boolean;
  title: string;
  leading?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className="scope-item"
    >
      <div className="flex items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              active ? "text-primary" : "text-foreground",
            )}
          >
            {title}
          </p>
        </div>
      </div>
    </button>
  );
}

export function KnowledgeTabPageState({
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
