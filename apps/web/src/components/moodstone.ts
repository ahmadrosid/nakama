import { getProfileAvatarUrl } from "@nakama/client";
import type { ProfileSummary } from "@nakama/core/contract";
import { moodstoneAvatars, moodstoneColors } from "./moodstone-avatars";

export type ProfileAvatarProfile = Pick<
  ProfileSummary,
  "id" | "name" | "hasAvatar" | "updatedAt" | "isSuper"
> &
  Partial<Pick<ProfileSummary, "createdAt">>;

export const SUPER_AGENT_DEFAULT_AVATAR = "/super-agent.png";

/** Profiles created before Moodstone shipped keep their Hashvatar look. */
const MOODSTONE_SINCE = Date.parse("2026-10-10T00:00:00Z");

// create_profile chat cards carry only updatedAt, which is the creation time there.
export function isPreMoodstone(profile: ProfileAvatarProfile): boolean {
  return Date.parse(profile.createdAt ?? profile.updatedAt) < MOODSTONE_SINCE;
}

export function resolveAvatarSrc(
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

/** The generated Moodstone look: no upload, and not an older dithered profile. */
export function isMoodstoneAvatar(
  profile: ProfileAvatarProfile,
  orgId?: string
): boolean {
  return resolveAvatarSrc(profile, orgId) === null && !isPreMoodstone(profile);
}

/** Default Moodstone shape and color for a profile identity. */
export function moodstoneIndexes(identity: string) {
  let hash = 0;

  for (let index = 0; index < identity.length; index++) {
    hash = (hash * 31 + identity.charCodeAt(index)) % 0x1_00_00_00_00;
  }

  return {
    avatarIndex: hash % moodstoneAvatars.length,
    colorIndex:
      Math.floor(hash / moodstoneAvatars.length) % moodstoneColors.length,
  };
}

export function moodstoneSvg(
  avatarIndex: number,
  colorIndex: number,
  animated = false
): string {
  const avatar = moodstoneAvatars[avatarIndex];
  const color = moodstoneColors[colorIndex];

  return (animated ? avatar.animated : avatar.still)
    .replaceAll("MOODSTONE_LIT", color.lit)
    .replaceAll("MOODSTONE_SHADE", color.shade);
}
