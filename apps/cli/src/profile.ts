import * as readline from "node:readline/promises";
import type { ProfileSummary } from "@nakama/core";
import { pickProfileForOrg } from "@nakama/core";
import type { NakamaClient } from "@nakama/client";
import { loadSavedCliProfileId, saveCliProfileId } from "./cli-config";

export interface CliProfileOptions {
  profileId?: string;
}

export function parseCliProfileArgs(argv = process.argv.slice(2)): CliProfileOptions {
  let profileId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--profile" || arg === "-p") {
      profileId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      profileId = arg.slice("--profile=".length).trim();
    }
  }

  return { profileId: profileId || undefined };
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

export function formatProfileLine(profile: ProfileSummary, index: number): string {
  const markers = [
    profile.isDefault ? "default" : null,
    profile.isSuper ? "orchestrator" : null,
    profile.id,
  ]
    .filter(Boolean)
    .join(", ");

  return `  ${index + 1}) ${profile.name} (${markers})`;
}

export function printProfiles(
  profiles: ProfileSummary[],
  options: { currentProfileId?: string } = {},
): void {
  const sorted = sortProfilesForPicker(profiles);

  if (sorted.length === 0) {
    console.log("No profiles available.\n");
    return;
  }

  if (options.currentProfileId) {
    const current = sorted.find((profile) => profile.id === options.currentProfileId);
    console.log(`Current: ${current?.name ?? options.currentProfileId}\n`);
  }

  for (const [index, profile] of sorted.entries()) {
    const marker = profile.id === options.currentProfileId ? "*" : " ";
    console.log(`${marker}${formatProfileLine(profile, index).trimStart()}`);
  }

  console.log("\nUse /profile <id or name> to switch.\n");
}

function findProfile(
  profiles: ProfileSummary[],
  profileId: string,
): ProfileSummary | undefined {
  return (
    resolveProfileInput(profiles, profileId) ??
    profiles.find((profile) => profile.id === profileId)
  );
}

export async function resolveStartupProfile(
  client: NakamaClient,
  options: CliProfileOptions,
): Promise<{ profileId: string; profile: ProfileSummary }> {
  const { profiles } = await client.listProfiles();

  if (profiles.length === 0) {
    throw new Error("No bot profiles found.");
  }

  const explicitProfileId = options.profileId?.trim();
  const savedProfileId = explicitProfileId ? null : await loadSavedCliProfileId();
  const candidateProfileId = explicitProfileId ?? savedProfileId ?? undefined;

  if (candidateProfileId) {
    const match = findProfile(profiles, candidateProfileId);

    if (match) {
      await saveCliProfileId(match.id);
      return { profileId: match.id, profile: match };
    }

    if (explicitProfileId) {
      throw new Error(`Unknown profile: ${explicitProfileId}`);
    }
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const fallback = pickProfileForOrg(profiles);

    await saveCliProfileId(fallback.id);
    return { profileId: fallback.id, profile: fallback };
  }

  const selected = await promptForProfile(profiles);
  await saveCliProfileId(selected.profileId);
  return selected;
}

async function promptForProfile(
  profiles: ProfileSummary[],
): Promise<{ profileId: string; profile: ProfileSummary }> {
  const sorted = sortProfilesForPicker(profiles);
  const defaultProfile = pickProfileForOrg(sorted);

  console.log("Select a bot profile:\n");

  for (const [index, profile] of sorted.entries()) {
    console.log(formatProfileLine(profile, index));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const input = (await rl.question("\nProfile (optional): ")).trim();
    const selected = resolveProfileInput(sorted, input) ?? defaultProfile;

    console.log(`Using ${selected.name}.\n`);

    return { profileId: selected.id, profile: selected };
  } finally {
    rl.close();
  }
}
