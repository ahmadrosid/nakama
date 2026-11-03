import { getProfileAvatarUrl } from "@nakama/client";
import type { ProfileSummary } from "@nakama/core/contract";
import {
  CUT_KEYS,
  DEFAULT_SEED,
  EYE_WHITE,
  litShade,
  type Mood,
  PALETTE,
  PALETTE_KEYS,
  resolveSpec,
  stillFrame,
} from "./core";
import { renderAnimatedAvatarSvg, renderAvatarSvg } from "./svg";

export type ProfileAvatarProfile = Pick<
  ProfileSummary,
  "id" | "name" | "hasAvatar" | "updatedAt" | "isSuper"
> &
  Partial<Pick<ProfileSummary, "createdAt">>;

/** What the agent is doing right now, as shown by its animated avatar. */
export type AgentActivity =
  | "idle"
  | "thinking"
  | "tool"
  | "responding"
  | "error"
  | "done";

const ACTIVITY_MOODS: Record<AgentActivity, Mood> = {
  done: "done",
  error: "failed",
  idle: "idle",
  responding: "working",
  thinking: "thinking",
  tool: "observing",
};

export const SUPER_AGENT_DEFAULT_AVATAR = "/super-agent.png";

/** Profiles created before Moodstone shipped keep their Hashvatar look. */
const MOODSTONE_SINCE = Date.parse("2026-10-10T00:00:00Z");

/** The cut order profiles hash against; append only, or faces change. */
export const MOODSTONE_CUTS = CUT_KEYS;

/** Palette order profiles hash against; append only, or colors change. */
export const MOODSTONE_COLORS = PALETTE_KEYS.map((name) => {
  const [lit, shade] = litShade(PALETTE[name]);

  return { lit, name, shade };
});

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
    avatarIndex: hash % MOODSTONE_CUTS.length,
    colorIndex:
      Math.floor(hash / MOODSTONE_CUTS.length) % MOODSTONE_COLORS.length,
  };
}

export function moodForActivity(activity: AgentActivity): Mood {
  return ACTIVITY_MOODS[activity];
}

const MOODSTONE_NOTICE = `<!--
MIT License

Copyright (c) 2026 Ömer Karaca

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
-->`;

/** The SVG loops are image documents, so they carry their own MIT notice. */
function withNotice(svg: string): string {
  const openTagEnd = svg.indexOf(">") + 1;

  return svg.slice(0, openTagEnd) + MOODSTONE_NOTICE + svg.slice(openTagEnd);
}

export function moodstoneSvg(
  avatarIndex: number,
  colorIndex: number,
  animated = false,
  mood: Mood = "idle"
): string {
  const spec = resolveSpec({
    color: PALETTE[PALETTE_KEYS[colorIndex]],
    cut: MOODSTONE_CUTS[avatarIndex],
    eyeColor: EYE_WHITE,
    mood,
    seed: DEFAULT_SEED,
  });

  return withNotice(
    animated
      ? renderAnimatedAvatarSvg(spec, { fps: 24, size: 64 })
      : renderAvatarSvg(spec, stillFrame(spec), { size: 64 })
  );
}
