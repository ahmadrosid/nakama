import { moodstoneAvatars, moodstoneColors } from "./moodstone-avatars";

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
