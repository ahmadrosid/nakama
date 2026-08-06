import type { ProfileSummary } from "@nakama/core/contract";

export function findSuperBotProfile(profiles: ProfileSummary[]): ProfileSummary | undefined {
  return profiles.find((profile) => profile.isSuper);
}

/** Profile id to open for Super Bot chat CTAs, or null when none exists. */
export function resolveSuperBotChatProfileId(
  profiles: Array<Pick<ProfileSummary, "id" | "isSuper">>,
): string | null {
  return profiles.find((profile) => profile.isSuper)?.id ?? null;
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
