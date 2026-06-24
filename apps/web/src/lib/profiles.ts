import type { ProfileSummary } from "@tinyclaw/core/contract";

/** @deprecated Use {@link findSuperBotProfile} — super bots are org-scoped. */
export const SUPER_BOT_PROFILE_ID = "super_bot";

/** @deprecated Use {@link findDefaultProfile} — defaults are org-scoped. */
export const DEFAULT_PROFILE_ID = "default";

export function findSuperBotProfile(profiles: ProfileSummary[]): ProfileSummary | undefined {
  return profiles.find((profile) => profile.isSuper);
}

export function findDefaultProfile(profiles: ProfileSummary[]): ProfileSummary | undefined {
  return profiles.find((profile) => profile.isDefault) ?? profiles[0];
}

export function resolveInitialProfileId(
  profiles: Array<Pick<ProfileSummary, "id" | "isDefault">>,
): string {
  return (
    profiles.find((profile) => profile.isDefault)?.id ?? profiles[0]?.id ?? ""
  );
}
