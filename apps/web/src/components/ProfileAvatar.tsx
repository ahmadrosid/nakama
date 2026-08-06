import type { ProfileSummary } from "@nakama/core/contract";
import { getProfileAvatarUrl } from "@nakama/client";
import { hashToSeeds, oklchToCss } from "hashvatar";
import { Hashvatar } from "hashvatar/react";
import { cn } from "@/lib/utils";

type ProfileAvatarProfile = Pick<ProfileSummary, "id" | "name" | "hasAvatar" | "updatedAt">;

const sizeClasses = {
  xs: "size-5",
  sm: "size-7",
  md: "size-9",
  ml: "size-11",
  lg: "size-16",
} as const;

const sizePixels = {
  xs: 20,
  sm: 28,
  md: 36,
  ml: 44,
  lg: 64,
} as const;

/** Two OKLCH tones derived from the profile hash — same hash ⇒ same palette. */
function tonesFromHash(hash: string): [string, string] {
  const [h1, h2, l1, l2, c1, c2] = hashToSeeds(hash, 6);
  return [
    oklchToCss({
      l: 0.55 + l1 * 0.22,
      c: 0.16 + c1 * 0.14,
      h: h1 * 360,
    }),
    oklchToCss({
      // Offset hue so the pair stays distinct, still seeded by the hash.
      l: 0.28 + l2 * 0.2,
      c: 0.1 + c2 * 0.12,
      h: (h1 * 360 + 40 + h2 * 80) % 360,
    }),
  ];
}

export function ProfileAvatar({
  profile,
  size = "md",
  active = false,
  className,
}: {
  profile: ProfileAvatarProfile;
  size?: keyof typeof sizeClasses;
  /** Animate the hashvatar dither when this profile is selected. */
  active?: boolean;
  className?: string;
}) {
  const avatarUrl = getProfileAvatarUrl(profile);

  const surfaceClass = cn(
    "shrink-0 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
    sizeClasses[size],
    className,
  );

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={cn(surfaceClass, "object-cover")}
      />
    );
  }

  const hash = profile.id || profile.name || "?";

  return (
    <Hashvatar
      hash={hash}
      mode="dither"
      size={sizePixels[size]}
      tones={tonesFromHash(hash)}
      animated={active}
      className={surfaceClass}
      // Let Tailwind className control radius (Hashvatar defaults to 50%).
      style={{ borderRadius: undefined }}
    />
  );
}
