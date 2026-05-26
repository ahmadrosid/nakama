import type { ProfileSummary } from "@tinyclaw/core/contract";
import { getProfileAvatarUrl } from "@tinyclaw/client";
import { cn } from "@/lib/utils";

type ProfileAvatarProfile = Pick<ProfileSummary, "id" | "name" | "hasAvatar" | "updatedAt">;

const sizeClasses = {
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-16 text-xl",
} as const;

function profileInitial(profile: ProfileAvatarProfile): string {
  return (
    profile.name?.charAt(0)?.toUpperCase() ??
    profile.id?.charAt(0)?.toUpperCase() ??
    "?"
  );
}

export function ProfileAvatar({
  profile,
  size = "md",
  className,
}: {
  profile: ProfileAvatarProfile;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  const avatarUrl = getProfileAvatarUrl(profile);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover",
          sizeClasses[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground",
        sizeClasses[size],
        className,
      )}
    >
      {profileInitial(profile)}
    </span>
  );
}
