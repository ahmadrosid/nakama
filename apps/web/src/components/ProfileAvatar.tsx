import { getProfileAvatarUrl } from "@nakama/client";
import type { ProfileSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { moodstoneAvatars, moodstoneColors } from "./moodstone-avatars";

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
  /** Animate the generated SVG when this profile is selected in chat. */
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
