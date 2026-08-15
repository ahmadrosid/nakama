import type { ProfileSummary } from "@nakama/core/contract";
import { ArrowDown01Icon } from "hugeicons-react";
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
              aria-label={switchLabel}
              className={cn(
                "h-7 gap-1.5 rounded-full px-1.5 font-medium text-foreground text-xs hover:bg-muted/60",
                className
              )}
              disabled={disabled}
              size="sm"
              title={activeProfile?.name ?? "Switch profile"}
              type="button"
              variant="ghost"
            />
          ) : (
            <Button
              aria-label={switchLabel}
              className={cn(composerIconButtonClass, "p-0", className)}
              disabled={disabled}
              size="icon-sm"
              title={activeProfile?.name ?? "Switch profile"}
              type="button"
              variant="ghost"
            />
          )
        }
      >
        {variant === "prominent" ? (
          <>
            {activeProfile ? (
              <ProfileAvatar
                active
                className="size-4"
                profile={activeProfile}
                size="xs"
              />
            ) : (
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-background font-medium text-2xs">
                ?
              </span>
            )}
            <span className="max-w-[10rem] truncate">
              {activeProfile ? profileLabel(activeProfile) : "Select profile"}
            </span>
            <ArrowDown01Icon
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground"
            />
          </>
        ) : activeProfile ? (
          <ProfileAvatar
            active
            className="size-7"
            profile={activeProfile}
            size="sm"
          />
        ) : (
          <span className="font-medium text-xs">?</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-52">
        {profiles.map((profile) => (
          <DropdownMenuItem
            disabled={profile.id === profileId}
            key={profile.id}
            onClick={() => onProfileSwitch(profile.id)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ProfileAvatar
                active={profile.id === profileId}
                profile={profile}
                size="sm"
              />
              <span className="whitespace-nowrap">{profileLabel(profile)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
