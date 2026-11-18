import type { ProfileSummary } from "@nakama/core/contract";

export function findSuperNakamaProfile(
  profiles: ProfileSummary[]
): ProfileSummary | undefined {
  return profiles.find((profile) => profile.isSuper);
}

/** Profile id to open for Super Nakama chat CTAs, or null when none exists. */
export function resolveSuperNakamaChatProfileId(
  profiles: Array<Pick<ProfileSummary, "id" | "isSuper">>
): string | null {
  return profiles.find((profile) => profile.isSuper)?.id ?? null;
}

/** True for the member who created the agent. Admin-created agents have no owner. */
export function isProfileOwner(
  profile: Pick<ProfileSummary, "ownerUserId"> | null | undefined,
  userId: string | undefined
): boolean {
  return Boolean(userId) && profile?.ownerUserId === userId;
}

/** True when the user can change the agent's tools. Shared agents are read-only. */
export function canManageAgent(
  profile: { ownerUserId?: string | null; sharedAgent?: unknown } | undefined,
  user: { id?: string; isPlatformAdmin?: boolean } | null | undefined,
  isOrgAdmin: boolean
): boolean {
  return (
    Boolean(profile && !profile.sharedAgent) &&
    (isOrgAdmin ||
      user?.isPlatformAdmin === true ||
      isProfileOwner(profile, user?.id))
  );
}

export function findDefaultProfile(
  profiles: ProfileSummary[]
): ProfileSummary | undefined {
  return profiles.find((profile) => profile.isDefault) ?? profiles[0];
}

export function resolveInitialProfileId(
  profiles: Array<Pick<ProfileSummary, "id" | "isDefault">>
): string {
  return (
    profiles.find((profile) => profile.isDefault)?.id ?? profiles[0]?.id ?? ""
  );
}
