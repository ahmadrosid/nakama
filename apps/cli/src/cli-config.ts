import { join } from "node:path";
import { getUserConfigDir, readTextOrNull, writeTextFile } from "@nakama/core";

const CLI_CONFIG_KEYS = new Set(["org_id", "profile_id"]);

export function getCliConfigPath(): string {
  return join(getUserConfigDir(), "cli.ini");
}

export async function loadSavedCliProfileId(): Promise<string | null> {
  return loadCliConfigValue("profile_id");
}

export async function loadSavedCliOrgId(): Promise<string | null> {
  return loadCliConfigValue("org_id");
}

export async function saveCliProfileId(profileId: string): Promise<void> {
  await saveCliConfigValue("profile_id", profileId);
}

export async function saveCliOrgId(orgId: string): Promise<void> {
  await saveCliConfigValue("org_id", orgId);
}

async function loadCliConfigValue(key: string): Promise<string | null> {
  const values = await readCliConfigValues();
  const value = values[key]?.trim();
  return value || null;
}

async function saveCliConfigValue(key: string, value: string): Promise<void> {
  const trimmed = value.trim();

  if (!trimmed) {
    return;
  }

  const values = await readCliConfigValues();
  values[key] = trimmed;
  await writeCliConfig(values);
}

async function readCliConfigValues(): Promise<Record<string, string>> {
  const raw = await readTextOrNull(getCliConfigPath());

  if (raw === null) {
    return {};
  }

  return parseIni(raw);
}

async function writeCliConfig(values: Record<string, string>): Promise<void> {
  const lines = ["# Nakama CLI"];

  if (values.org_id?.trim()) {
    lines.push(`org_id=${values.org_id.trim()}`);
  }

  if (values.profile_id?.trim()) {
    lines.push(`profile_id=${values.profile_id.trim()}`);
  }

  lines.push("");

  await writeTextFile(getCliConfigPath(), lines.join("\n"), {
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

    if (!CLI_CONFIG_KEYS.has(key)) {
      continue;
    }

    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}
