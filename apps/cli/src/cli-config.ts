import { join } from "node:path";
import { getUserConfigDir, readTextOrNull, writePrivateTextFile } from "@nakama/core";

export function getCliConfigPath(): string {
  return join(getUserConfigDir(), "cli.ini");
}

export async function loadSavedCliProfileId(): Promise<string | null> {
  const raw = await readTextOrNull(getCliConfigPath());

  if (raw === null) {
    return null;
  }

  const profileId = parseIni(raw).profile_id?.trim();

  return profileId || null;
}

export async function saveCliProfileId(profileId: string): Promise<void> {
  const trimmed = profileId.trim();

  if (!trimmed) {
    return;
  }

  const lines = ["# Nakama CLI", `profile_id=${trimmed}`, ""];

  await writePrivateTextFile(getCliConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

function parseIni(raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}
