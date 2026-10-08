import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  getUserConfigPath,
  parseIniWithSections,
  writeParsedConfigIni,
} from "@nakama/core";
import type { OrgRole } from "@nakama/core/contract";
import { ORG_ROLES } from "@nakama/db";

const MFA_SECTION = "security";

const ENABLED_KEY = "mfa_enabled";

const REQUIRED_KEY = "mfa_required";

const ENFORCED_ROLES_KEY = "mfa_enforced_roles";

const ENCRYPTION_KEY = "mfa_encryption_key";

type CachedMfaEncryptionKey = {
  ino: number;
  mtimeMs: number;
  path: string;
  size: number;
  value: string;
};

let cachedMfaEncryptionKey: CachedMfaEncryptionKey | null = null;

export interface MfaPolicy {
  enabled: boolean;
  enforcedRoles: OrgRole[];
  keyConfigured: boolean;
  required: boolean;
}

async function readConfig() {
  let raw = "";

  try {
    raw = await readFile(getUserConfigPath(), "utf8");
  } catch (error) {
    if (getNodeErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  return parseIniWithSections(raw);
}

export async function loadMfaPolicy(): Promise<MfaPolicy> {
  const parsed = await readConfig();
  const security = parsed.sections[MFA_SECTION] ?? {};

  const enforcedRoles = security[ENFORCED_ROLES_KEY]
    ?.split(",")
    .filter(isOrgRole) ?? [...ORG_ROLES];

  return {
    enabled: security[ENABLED_KEY] === "true",
    enforcedRoles,
    keyConfigured: Boolean(security[ENCRYPTION_KEY]),
    required: security[REQUIRED_KEY] === "true",
  };
}

export async function updateMfaPolicy(input: {
  enabled?: boolean;
  enforcedRoles?: OrgRole[];
  required?: boolean;
}): Promise<MfaPolicy> {
  const parsed = await readConfig();
  const existingRoles = parsed.sections[MFA_SECTION]?.[ENFORCED_ROLES_KEY];

  const enforcedRoles =
    input.enforcedRoles ?? existingRoles?.split(",").filter(isOrgRole);

  const initializeRoles =
    input.required === true && !existingRoles ? [...ORG_ROLES] : enforcedRoles;

  const security = { ...parsed.sections[MFA_SECTION] };

  if (initializeRoles) {
    security[ENFORCED_ROLES_KEY] = initializeRoles.join(",");
  }

  if (input.enabled !== undefined) {
    security[ENABLED_KEY] = String(input.enabled);
  }

  if (input.required !== undefined) {
    security[REQUIRED_KEY] = String(input.required);
  }

  await writeParsedConfigIni(parsed.global, {
    ...parsed.sections,
    [MFA_SECTION]: security,
  });

  return loadMfaPolicy();
}

type MfaConfigMetadata = Pick<
  CachedMfaEncryptionKey,
  "ino" | "mtimeMs" | "size"
>;

function readMfaConfigMetadata(configPath: string): MfaConfigMetadata {
  try {
    const { ino, mtimeMs, size } = statSync(configPath);

    return { ino, mtimeMs, size };
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      cachedMfaEncryptionKey = null;
      throw new Error("MFA encryption key is not configured.");
    }

    throw error;
  }
}

function cacheMfaEncryptionKey(configPath: string, value: string): void {
  cachedMfaEncryptionKey = {
    path: configPath,
    ...readMfaConfigMetadata(configPath),
    value,
  };
}

export async function ensureMfaEncryptionKey(): Promise<string> {
  const configPath = getUserConfigPath();
  const parsed = await readConfig();
  const existing = parsed.sections[MFA_SECTION]?.[ENCRYPTION_KEY];

  if (existing) {
    cacheMfaEncryptionKey(configPath, existing);

    return existing;
  }

  const key = randomBytes(32).toString("base64url");
  await writeParsedConfigIni(parsed.global, {
    ...parsed.sections,
    [MFA_SECTION]: {
      ...parsed.sections[MFA_SECTION],
      [ENCRYPTION_KEY]: key,
    },
  });
  cacheMfaEncryptionKey(configPath, key);

  return key;
}

export function getMfaEncryptionKey(): string {
  const configPath = getUserConfigPath();
  const metadata = readMfaConfigMetadata(configPath);

  if (
    cachedMfaEncryptionKey &&
    cachedMfaEncryptionKey.path === configPath &&
    cachedMfaEncryptionKey.ino === metadata.ino &&
    cachedMfaEncryptionKey.mtimeMs === metadata.mtimeMs &&
    cachedMfaEncryptionKey.size === metadata.size
  ) {
    return cachedMfaEncryptionKey.value;
  }

  const value = parseIniWithSections(readFileSync(configPath, "utf8")).sections[
    MFA_SECTION
  ]?.[ENCRYPTION_KEY];

  if (!value) {
    throw new Error("MFA encryption key is not configured.");
  }

  cachedMfaEncryptionKey = { path: configPath, ...metadata, value };

  return value;
}

function isOrgRole(role: string): role is OrgRole {
  return ORG_ROLES.some((knownRole) => knownRole === role);
}

function getNodeErrorCode<T>(error: T): string | undefined {
  if (!(error instanceof Error && "code" in error)) {
    return;
  }

  const code = error.code;

  return isString(code) ? code : undefined;
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
