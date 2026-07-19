import type { ProfileSummary } from "@nakama/core/contract";
import { ChevronDownIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { composerIconButtonClass } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

function profileLabel(profile: ProfileSummary): string {
  return profile.isSuper ? `${profile.name} (super)` : profile.name;
}

export function ChatProfileSwitcher({
  profileId,
  profiles,
  activeProfile,
  onProfileSwitch,
  variant = "compact",
  disabled = false,
  className,
}: {
  profileId: string;
  profiles: ProfileSummary[];
  activeProfile?: ProfileSummary;
  onProfileSwitch: (profileId: string) => void;
  variant?: "compact" | "prominent";
  disabled?: boolean;
  className?: string;
}) {
  const switchLabel = activeProfile
    ? `Switch profile (${activeProfile.name})`
    : "Switch profile";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          variant === "prominent" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={switchLabel}
              title={activeProfile?.name ?? "Switch profile"}
              className={cn(
                "h-7 gap-1.5 rounded-full px-1.5 text-xs font-medium text-foreground hover:bg-muted/60",
                className,
              )}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={switchLabel}
              title={activeProfile?.name ?? "Switch profile"}
              className={cn(composerIconButtonClass, "p-0", className)}
            />
          )
        }
      >
        {variant === "prominent" ? (
          <>
            {activeProfile ? (
              <ProfileAvatar profile={activeProfile} size="xs" className="size-4" />
            ) : (
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-background text-[9px] font-medium">
                ?
              </span>
            )}
            <span className="max-w-[10rem] truncate">
              {activeProfile ? profileLabel(activeProfile) : "Select profile"}
            </span>
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </>
        ) : activeProfile ? (
          <ProfileAvatar profile={activeProfile} size="sm" className="size-7" />
        ) : (
          <span className="text-xs font-medium">?</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 w-auto">
        {profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            disabled={profile.id === profileId}
            onClick={() => onProfileSwitch(profile.id)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ProfileAvatar profile={profile} size="sm" />
              <span className="whitespace-nowrap">{profileLabel(profile)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
