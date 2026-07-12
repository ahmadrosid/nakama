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

export function slugifyProfileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "profile"
  );
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
  const superBotAliases = new Set(["super_bot", "super-bot", "superbot", "super bot"]);

  if (superBotAliases.has(lower)) {
    const superBots = profiles.filter((profile) => profile.isSuper);

    if (superBots.length === 1) {
      return superBots[0];
    }
  }

  const exactName = profiles.filter((profile) => profile.name.toLowerCase() === lower);

  if (exactName.length === 1) {
    return exactName[0];
  }

  const slugMatches = profiles.filter(
    (profile) =>
      slugifyProfileName(profile.name) === lower || slugifyProfileName(profile.id) === lower,
  );

  if (slugMatches.length === 1) {
    return slugMatches[0];
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

  return findNearSlugProfileMatch(profiles, trimmed);
}

export function isProfileSelectionIndexInput(
  input: string,
  profileCount: number,
): boolean {
  const trimmed = input.trim();

  if (!trimmed || trimmed.startsWith("/") || /\s/.test(trimmed)) {
    return false;
  }

  const numeric = Number(trimmed);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= profileCount;
}

function levenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) =>
      rowIndex === 0 ? colIndex : colIndex === 0 ? rowIndex : 0,
    ),
  );

  for (let rowIndex = 1; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 1; colIndex < cols; colIndex += 1) {
      const cost = left[rowIndex - 1] === right[colIndex - 1] ? 0 : 1;
      matrix[rowIndex]![colIndex] = Math.min(
        matrix[rowIndex - 1]![colIndex]! + 1,
        matrix[rowIndex]![colIndex - 1]! + 1,
        matrix[rowIndex - 1]![colIndex - 1]! + cost,
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

function findNearSlugProfileMatch(
  profiles: ProfileSummary[],
  input: string,
): ProfileSummary | undefined {
  const lower = input.trim().toLowerCase();

  if (!lower.includes("-")) {
    return undefined;
  }

  const nearMatches = profiles.filter(
    (profile) => levenshtein(slugifyProfileName(profile.name), lower) <= 1,
  );

  return nearMatches.length === 1 ? nearMatches[0] : undefined;
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

export interface ProfileScope {
  orgId: string;
  orgName: string;
  profiles: ProfileSummary[];
}

export function resolveProfileInScopes(
  scopes: ProfileScope[],
  input: string,
): { scope: ProfileScope; profile: ProfileSummary } | { ambiguous: string } | null {
  const matches: Array<{ scope: ProfileScope; profile: ProfileSummary }> = [];

  for (const scope of scopes) {
    const profile = resolveProfileInput(scope.profiles, input);

    if (profile) {
      matches.push({ scope, profile });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return { scope: matches[0]!.scope, profile: matches[0]!.profile };
  }

  return {
    ambiguous: matches.map(({ scope, profile }) => `${profile.name} in ${scope.orgName}`).join(", "),
  };
}

export function formatProfileSelectionPrompt(
  profiles: ProfileSummary[],
  currentProfileId?: string | null,
  orgName?: string | null,
): string {
  const sorted = sortProfilesForPicker(profiles);
  const current = currentProfileId
    ? sorted.find((profile) => profile.id === currentProfileId)
    : undefined;

  return [
    orgName
      ? `Choose a profile in ${orgName} (reply with a number, id, or name):`
      : "Choose a profile (reply with a number, id, or name):",
    "",
    ...sorted.map((profile, index) => formatProfileListLine(profile, index)),
    "",
    current ? `Current: ${current.name}` : "Current: none selected",
    "",
    "Switch with /profile 2, /profile <id>, or /profile <name>",
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
    const match = resolveProfileInput(profiles, preferredProfileId);

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
