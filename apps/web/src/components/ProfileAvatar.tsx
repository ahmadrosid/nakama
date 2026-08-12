import { getProfileAvatarUrl } from "@nakama/client";
import type { ProfileSummary } from "@nakama/core/contract";
import { hashToSeeds, oklchToCss } from "hashvatar";
import { Hashvatar } from "hashvatar/react";
import { cn } from "@/lib/utils";

type ProfileAvatarProfile = Pick<
  ProfileSummary,
  "id" | "name" | "hasAvatar" | "updatedAt" | "isSuper"
>;

const SUPER_AGENT_DEFAULT_AVATAR = "/super-agent.png";

const sizeClasses = {
  lg: "size-16",
  md: "size-9",
  ml: "size-11",
  sm: "size-7",
  xs: "size-5",
} as const;

const sizePixels = {
  lg: 64,
  md: 36,
  ml: 44,
  sm: 28,
  xs: 20,
} as const;

/** Two OKLCH tones derived from the profile hash — same hash ⇒ same palette. */
function tonesFromHash(hash: string): [string, string] {
  const [h1, h2, l1, l2, c1, c2] = hashToSeeds(hash, 6);
  return [
    oklchToCss({
      c: 0.16 + c1 * 0.14,
      h: h1 * 360,
      l: 0.55 + l1 * 0.22,
    }),
    oklchToCss({
      c: 0.1 + c2 * 0.12,
      h: (h1 * 360 + 40 + h2 * 80) % 360,
      // Offset hue so the pair stays distinct, still seeded by the hash.
      l: 0.28 + l2 * 0.2,
    }),
  ];
}

function resolveAvatarSrc(profile: ProfileAvatarProfile): string | null {
  const uploaded = getProfileAvatarUrl(profile);
  if (uploaded) {
    return uploaded;
  }

  if (profile.isSuper) {
    return SUPER_AGENT_DEFAULT_AVATAR;
  }

  return null;
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
  const avatarUrl = resolveAvatarSrc(profile);

  const surfaceClass = cn(
    "shrink-0 rounded-full outline outline-1 outline-black/10 -outline-offset-1 dark:outline-white/10",
    sizeClasses[size],
    className
  );

  if (avatarUrl) {
    return (
      <img
        alt=""
        className={cn(surfaceClass, "object-cover")}
        src={avatarUrl}
      />
    );
  }

  const hash = profile.id || profile.name || "?";

  return (
    <Hashvatar
      animated={active}
      className={surfaceClass}
      hash={hash}
      mode="dither"
      size={sizePixels[size]}
      // Let Tailwind className control radius (Hashvatar defaults to 50%).
      style={{ borderRadius: undefined }}
      tones={tonesFromHash(hash)}
    />
  );
}
