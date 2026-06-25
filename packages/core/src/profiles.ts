import type { OrgRole, ProfileSummary } from "./contract";

export function canAccessSuperBotProfile(options: {
  orgRole?: OrgRole | null;
  isPlatformAdmin?: boolean;
}): boolean {
  return options.isPlatformAdmin === true || options.orgRole === "admin";
}

export function filterProfilesForChatAccess(
  profiles: ProfileSummary[],
  options: {
    orgRole?: OrgRole | null;
    isPlatformAdmin?: boolean;
    excludeSuperBot?: boolean;
  } = {},
): ProfileSummary[] {
  if (options.excludeSuperBot || !canAccessSuperBotProfile(options)) {
    return profiles.filter((profile) => !profile.isSuper);
  }

  return profiles;
}

export function sortProfilesForPicker(profiles: ProfileSummary[]): ProfileSummary[] {
  return [...profiles].sort((left, right) => {
    if (left.isDefault && !right.isDefault) {
      return -1;
    }

    if (right.isDefault && !left.isDefault) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export function resolveProfileInput(
  profiles: ProfileSummary[],
  input: string,
): ProfileSummary | undefined {
  const trimmed = input.trim();

  if (!trimmed) {
    return undefined;
  }

  const exactId = profiles.find((profile) => profile.id === trimmed);

  if (exactId) {
    return exactId;
  }

  const lower = trimmed.toLowerCase();
  const exactName = profiles.filter((profile) => profile.name.toLowerCase() === lower);

  if (exactName.length === 1) {
    return exactName[0];
  }

  const sorted = sortProfilesForPicker(profiles);
  const numeric = Number(trimmed);

  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= sorted.length) {
    return sorted[numeric - 1];
  }

  const partialMatches = profiles.filter(
    (profile) =>
      profile.id.toLowerCase().includes(lower) ||
      profile.name.toLowerCase().includes(lower),
  );

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  return undefined;
}

function formatProfileListLine(profile: ProfileSummary, index: number): string {
  const markers = [
    profile.isDefault ? "default" : null,
    profile.isSuper ? "orchestrator" : null,
    profile.id,
  ]
    .filter(Boolean)
    .join(", ");

  return `${index + 1}. ${profile.name} (${markers})`;
}

export function formatProfileSelectionPrompt(
  profiles: ProfileSummary[],
  currentProfileId?: string | null,
): string {
  const sorted = sortProfilesForPicker(profiles);
  const current = currentProfileId
    ? sorted.find((profile) => profile.id === currentProfileId)
    : undefined;

  return [
    "Choose a profile (reply with a number, id, or name):",
    "",
    ...sorted.map((profile, index) => formatProfileListLine(profile, index)),
    "",
    current ? `Current: ${current.name}` : "Current: none selected",
    "",
    "/profile — show this list again",
  ].join("\n");
}

export function formatProfileSwitchConfirmation(profileName: string): string {
  return `Now using ${profileName}. Chat history reset.`;
}

export function pickProfileForOrg(
  profiles: ProfileSummary[],
  preferredProfileId?: string,
): ProfileSummary {
  if (preferredProfileId) {
    const match = profiles.find((profile) => profile.id === preferredProfileId);

    if (match) {
      return match;
    }
  }

  const defaultProfile = profiles.find((profile) => profile.isDefault);

  if (defaultProfile) {
    return defaultProfile;
  }

  if (profiles.length === 0) {
    throw new Error("No profiles are available.");
  }

  return profiles[0]!;
}
