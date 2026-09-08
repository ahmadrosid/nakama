import { join } from "node:path";
import {
  getUserConfigDir,
  parseIni,
  readTextOrNull,
  writeTextFile,
} from "@nakama/core";

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

  return Object.fromEntries(
    Object.entries(parseIni(raw)).filter(([key]) => CLI_CONFIG_KEYS.has(key))
  );
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
