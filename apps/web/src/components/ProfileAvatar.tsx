import { getProfileAvatarUrl } from "@nakama/client";
import type { ProfileSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { hashToSeeds, oklchToCss } from "hashvatar";
import { Hashvatar } from "hashvatar/react";
import { useEffect, useMemo, useState } from "react";
import { moodstoneAvatars, moodstoneColors } from "./moodstone-avatars";

type ProfileAvatarProfile = Pick<
  ProfileSummary,
  "id" | "name" | "hasAvatar" | "updatedAt" | "isSuper"
> &
  Partial<Pick<ProfileSummary, "createdAt">>;

const SUPER_AGENT_DEFAULT_AVATAR = "/super-agent.png";

/** Profiles created before Moodstone shipped keep their Hashvatar look. */
const MOODSTONE_SINCE = Date.parse("2026-10-10T00:00:00Z");

const sizeClasses = {
  lg: "size-16",
  md: "size-9",
  ml: "size-11",
  sm: "size-7",
  xs: "size-5",
  xxs: "size-[18px]",
} as const;

const sizePixels = {
  lg: 64,
  md: 36,
  ml: 44,
  sm: 28,
  xs: 20,
  xxs: 18,
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

// create_profile chat cards carry only updatedAt, which is the creation time there.
function isPreMoodstone(profile: ProfileAvatarProfile): boolean {
  return Date.parse(profile.createdAt ?? profile.updatedAt) < MOODSTONE_SINCE;
}

function resolveAvatarSrc(
  profile: ProfileAvatarProfile,
  orgId?: string
): string | null {
  const uploaded = getProfileAvatarUrl(profile, orgId);

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
  orgId,
}: {
  profile: ProfileAvatarProfile;
  size?: keyof typeof sizeClasses;
  /** Animate the generated avatar when this profile is selected in chat. */
  active?: boolean;
  className?: string;
  orgId?: string;
}) {
  const avatarUrl = resolveAvatarSrc(profile, orgId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Start still on the server and before the motion preference is known.
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  const src = useMemo(() => {
    if (avatarUrl && avatarUrl !== failedUrl) {
      return avatarUrl;
    }

    const identity = profile.id || profile.name || "?";
    let hash = 0;

    for (let index = 0; index < identity.length; index++) {
      hash = (hash * 31 + identity.charCodeAt(index)) % 0x1_00_00_00_00;
    }

    const avatar = moodstoneAvatars[hash % moodstoneAvatars.length];

    const color =
      moodstoneColors[
        Math.floor(hash / moodstoneAvatars.length) % moodstoneColors.length
      ];

    const template = active && !reducedMotion ? avatar.animated : avatar.still;

    const svg = template
      .replaceAll("MOODSTONE_LIT", color.lit)
      .replaceAll("MOODSTONE_SHADE", color.shade);

    // An image document isolates SVG gradient IDs, even for repeated profiles.
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [avatarUrl, failedUrl, profile.id, profile.name, active, reducedMotion]);

  const surfaceClass = cn(
    "shrink-0 rounded-full outline outline-1 outline-black/10 -outline-offset-1 dark:outline-white/10",
    sizeClasses[size],
    className
  );

  const showUploaded = avatarUrl !== null && avatarUrl !== failedUrl;

  if (!showUploaded && isPreMoodstone(profile)) {
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

  return (
    <img
      alt=""
      className={cn(surfaceClass, "object-cover")}
      height={sizePixels[size]}
      onError={() => setFailedUrl(avatarUrl)}
      src={src}
      width={sizePixels[size]}
    />
  );
}
