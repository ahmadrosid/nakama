import { cn } from "@nakama/ui/utils";
import { hashToSeeds, oklchToCss } from "hashvatar";
import { Hashvatar } from "hashvatar/react";
import { useEffect, useMemo, useState } from "react";
import {
  isPreMoodstone,
  moodstoneIndexes,
  moodstoneSvg,
  type ProfileAvatarProfile,
  resolveAvatarSrc,
  SUPER_AGENT_DEFAULT_AVATAR,
} from "./moodstone";

const SUPER_AGENT_LIGHT_AVATAR = "/super-agent-light.png";

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

export function ProfileAvatar({
  profile,
  size = "md",
  active = false,
  className,
  orgId,
  squareMoodstone = false,
}: {
  profile: ProfileAvatarProfile;
  size?: keyof typeof sizeClasses;
  /** Animate the generated avatar when this profile is selected in chat. */
  active?: boolean;
  className?: string;
  orgId?: string;
  /** Draw the generated Moodstone avatar square; images and dithers stay round. */
  squareMoodstone?: boolean;
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

    const { avatarIndex, colorIndex } = moodstoneIndexes(
      profile.id || profile.name || "?"
    );

    const svg = moodstoneSvg(avatarIndex, colorIndex, active && !reducedMotion);

    // An image document isolates SVG gradient IDs, even for repeated profiles.
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [avatarUrl, failedUrl, profile.id, profile.name, active, reducedMotion]);

  const showUploaded = avatarUrl !== null && avatarUrl !== failedUrl;

  const surfaceClass = cn(
    "shrink-0 outline outline-1 outline-black/10 -outline-offset-1 dark:outline-white/10",
    squareMoodstone && !showUploaded && !isPreMoodstone(profile)
      ? "rounded-none"
      : "rounded-full",
    sizeClasses[size],
    className
  );

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

  const image = (
    <img
      alt=""
      className={cn(
        surfaceClass,
        "object-cover",
        src === SUPER_AGENT_DEFAULT_AVATAR && "hidden dark:block"
      )}
      height={sizePixels[size]}
      onError={() => setFailedUrl(avatarUrl)}
      src={src}
      width={sizePixels[size]}
    />
  );

  if (src !== SUPER_AGENT_DEFAULT_AVATAR) {
    return image;
  }

  return (
    <>
      {image}
      <img
        alt=""
        className={cn(surfaceClass, "object-cover dark:hidden")}
        height={sizePixels[size]}
        src={SUPER_AGENT_LIGHT_AVATAR}
        width={sizePixels[size]}
      />
    </>
  );
}
