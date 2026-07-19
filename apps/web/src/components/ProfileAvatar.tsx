import type { ProfileSummary } from "@nakama/core/contract";
import { getProfileAvatarUrl } from "@nakama/client";
import { cn } from "@/lib/utils";

type ProfileAvatarProfile = Pick<ProfileSummary, "id" | "name" | "hasAvatar" | "updatedAt">;

const sizeClasses = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  ml: "size-11 text-base",
  lg: "size-16 text-xl",
} as const;

/** Stable soft fills keyed by profile id so missing images still look distinct. */
const AVATAR_FALLBACK_COLORS = [
  "bg-rose-500/20 text-rose-800 dark:text-rose-200",
  "bg-orange-500/20 text-orange-800 dark:text-orange-200",
  "bg-amber-500/20 text-amber-900 dark:text-amber-200",
  "bg-lime-500/20 text-lime-900 dark:text-lime-200",
  "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200",
  "bg-teal-500/20 text-teal-900 dark:text-teal-200",
  "bg-sky-500/20 text-sky-900 dark:text-sky-200",
  "bg-blue-500/20 text-blue-900 dark:text-blue-200",
  "bg-indigo-500/20 text-indigo-900 dark:text-indigo-200",
  "bg-fuchsia-500/20 text-fuchsia-900 dark:text-fuchsia-200",
] as const;

function profileInitial(profile: ProfileAvatarProfile): string {
  return (
    profile.name?.charAt(0)?.toUpperCase() ??
    profile.id?.charAt(0)?.toUpperCase() ??
    "?"
  );
}

function avatarFallbackColorClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_FALLBACK_COLORS[Math.abs(hash) % AVATAR_FALLBACK_COLORS.length];
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
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        sizeClasses[size],
        avatarFallbackColorClass(profile.id || profile.name || "?"),
        className,
      )}
    >
      {profileInitial(profile)}
    </span>
  );
}
