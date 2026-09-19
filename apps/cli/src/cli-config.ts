import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  getUserConfigDir,
  parseIni,
  readTextOrNull,
  writeTextFile,
} from "@nakama/core";

const CLI_CONFIG_KEYS = new Set(["org_id", "profile_id", "server_url"]);
let configScope = "";

export function setCliConfigScope(serverUrl?: string, userId?: string): void {
  configScope =
    serverUrl && userId
      ? `-${createHash("sha256")
          .update(JSON.stringify([serverUrl, userId]))
          .digest("hex")}`
      : "";
}

export function getCliConfigPath(): string {
  return join(getUserConfigDir(), `cli${configScope}.ini`);
}

export async function loadSavedCliServerUrl(): Promise<string | null> {
  const values = await readCliConfigValues(join(getUserConfigDir(), "cli.ini"));
  return values.server_url || null;
}

export async function saveCliServerUrl(serverUrl: string): Promise<void> {
  await saveCliConfigValue(
    "server_url",
    serverUrl,
    join(getUserConfigDir(), "cli.ini")
  );
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

async function saveCliConfigValue(
  key: string,
  value: string,
  path = getCliConfigPath()
): Promise<void> {
  const trimmed = value.trim();

  if (!trimmed) {
    return;
  }

  const values = await readCliConfigValues(path);
  values[key] = trimmed;
  await writeCliConfig(values, path);
}

async function readCliConfigValues(
  path = getCliConfigPath()
): Promise<Record<string, string>> {
  const raw = await readTextOrNull(path);

  if (raw === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parseIni(raw)).filter(([key]) => CLI_CONFIG_KEYS.has(key))
  );
}

async function writeCliConfig(
  values: Record<string, string>,
  path: string
): Promise<void> {
  const lines = ["# Nakama CLI"];

  for (const key of CLI_CONFIG_KEYS) {
    const value = values[key]?.trim();
    if (value) {
      lines.push(`${key}=${value}`);
    }
  }

  lines.push("");

  await writeTextFile(path, lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}
