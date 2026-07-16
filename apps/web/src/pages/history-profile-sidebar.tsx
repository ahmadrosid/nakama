import type { ProfileSummary } from "@nakama/core/contract";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HistoryProfileSidebar({
  profiles,
  profileId,
  busy,
  onProfileSelect,
  onGoToProfiles,
}: {
  profiles: ProfileSummary[];
  profileId: string;
  busy: boolean;
  onProfileSelect: (profileId: string) => void;
  onGoToProfiles: () => void;
}) {
  return (
    <aside className="h-full border-b border-border p-4 lg:border-r lg:border-b-0">
      <div className="space-y-3">
        <div>
          <h2 className="type-section-title">Profiles</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose which chat history to view.</p>
        </div>

        {profiles.length === 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={onGoToProfiles}>
            Go to Profiles
          </Button>
        ) : (
          <div className="space-y-1">
            {profiles.map((profile) => {
              const active = profile.id === profileId;

              return (
                <button
                  key={profile.id}
                  type="button"
                  disabled={busy}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                    active
                      ? "border-foreground/15 bg-muted text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
                  )}
                  onClick={() => onProfileSelect(profile.id)}
                >
                  <ProfileAvatar profile={profile} size="xs" />
                  <span className="truncate">{profile.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
