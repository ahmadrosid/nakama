import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  JsonSchema,
  ToolContext,
  ToolDefinition,
  ToolSetupPlan,
} from "@nakama/core";
import {
  ensureUserConfigDir,
  getCustomToolsDir,
  getUserConfigDir,
  getUserConfigPath,
  NakamaApiError,
  parseIniWithSections,
  permissiveObjectSchema,
  writeParsedConfigIni,
} from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";

const CREDENTIAL_SECTION_PREFIX = "tool-key.";
const SETUP_SECTION_PREFIX = "tool-setup.";

/**
 * Section names encode `[orgId, id]` as base64url so every entry belonging to
 * one organization can be enumerated and purged from the shared config file.
 */
function encodeOrgScopedSection(
  prefix: string,
  orgId: string,
  id: string
): string {
  return `${prefix}${Buffer.from(JSON.stringify([orgId, id])).toString("base64url")}`;
}

function credentialSection(orgId: string, toolId: string): string {
  return encodeOrgScopedSection(CREDENTIAL_SECTION_PREFIX, orgId, toolId);
}

function belongsToOrgSection(
  prefix: string,
  section: string,
  orgId: string
): boolean {
  if (!section.startsWith(prefix)) {
    return false;
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(section.slice(prefix.length), "base64url").toString("utf8")
    );
    return Array.isArray(decoded) && decoded[0] === orgId;
  } catch {
    // Not one of our encoded sections, so it is not this org's entry.
    return false;
  }
}

async function readConfig() {
  try {
    return parseIniWithSections(await readFile(getUserConfigPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { global: {}, sections: {} };
    }
    throw error;
  }
}

/**
 * Tool API keys are AES-256-GCM encrypted in config.ini. The encryption key
 * lives in its own owner-only file, so a copy of config.ini alone does not
 * reveal any tool key.
 */
const CREDENTIAL_KEY_FILE = "tool-credentials.key";

async function readCredentialEncryptionKey(): Promise<Buffer> {
  const keyPath = path.join(getUserConfigDir(), CREDENTIAL_KEY_FILE);
  try {
    return Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64url");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await ensureUserConfigDir();
  const key = randomBytes(32);
  try {
    await writeFile(keyPath, key.toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64url");
  }
}

async function encryptToolApiKey(
  orgId: string,
  apiKey: string
): Promise<Record<string, string>> {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    await readCredentialEncryptionKey(),
    iv
  );
  // Binding the org stops a ciphertext copied into another org's section
  // from decrypting there.
  cipher.setAAD(Buffer.from(orgId, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return {
    api_key_enc: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64url"
    ),
  };
}

async function decryptToolApiKey(
  orgId: string,
  credential: Record<string, string> | undefined
): Promise<string | undefined> {
  if (!credential?.api_key_enc) {
    // Keys saved before encryption stay readable until the next save.
    return credential?.api_key;
  }
  const encoded = Buffer.from(credential.api_key_enc, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await readCredentialEncryptionKey(),
    encoded.subarray(0, 12)
  );
  decipher.setAAD(Buffer.from(orgId, "utf8"));
  decipher.setAuthTag(encoded.subarray(12, 28));
  return Buffer.concat([
    decipher.update(encoded.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export async function loadToolApiKey(
  orgId: string,
  toolId: string
): Promise<string | undefined> {
  return decryptToolApiKey(
    orgId,
    (await readConfig()).sections[credentialSection(orgId, toolId)]
  );
}

let credentialWrite: Promise<void> = Promise.resolve();

function validateApiKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 8192 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new NakamaApiError("Enter a valid API key.", 400);
  }
  return value.trim();
}

export function saveToolApiKey(
  orgId: string,
  toolId: string,
  value: unknown
): Promise<void> {
  const apiKey = validateApiKey(value);
  const write = credentialWrite.then(async () => {
    const encrypted = await encryptToolApiKey(orgId, apiKey);
    const parsed = await readConfig();
    parsed.sections[credentialSection(orgId, toolId)] = encrypted;
    await writeParsedConfigIni(parsed.global, parsed.sections);
  });
  credentialWrite = write.catch(() => undefined);
  return write;
}

function setupSection(orgId: string, setupId: string): string {
  return encodeOrgScopedSection(SETUP_SECTION_PREFIX, orgId, setupId);
}

export async function loadToolSetup(
  orgId: string,
  setupId: string
): Promise<ToolSetupPlan> {
  const value = (await readConfig()).sections[setupSection(orgId, setupId)]
    ?.plan;
  if (!value) {
    throw new NakamaApiError("Tool setup not found.", 404);
  }
  return JSON.parse(value) as ToolSetupPlan;
}

export function saveToolSetup(
  orgId: string,
  plan: ToolSetupPlan
): Promise<void> {
  const write = credentialWrite.then(async () => {
    const parsed = await readConfig();
    parsed.sections[setupSection(orgId, plan.id)] = {
      plan: JSON.stringify(plan),
    };
    await writeParsedConfigIni(parsed.global, parsed.sections);
  });
  credentialWrite = write.catch(() => undefined);
  return write;
}

export function approveToolSetup(
  orgId: string,
  setupId: string,
  input: { profileId?: string; apiKey?: string }
): Promise<ToolSetupPlan> {
  const write = credentialWrite.then(async () => {
    const parsed = await readConfig();
    const section = setupSection(orgId, setupId);
    const value = parsed.sections[section]?.plan;
    if (!value) {
      throw new NakamaApiError("Tool setup not found.", 404);
    }
    const plan = JSON.parse(value) as ToolSetupPlan;
    if (plan.status !== "pending") {
      return plan;
    }
    if (plan.requiresApiKey) {
      parsed.sections[credentialSection(orgId, setupId)] =
        await encryptToolApiKey(orgId, validateApiKey(input.apiKey));
    }
    const approved: ToolSetupPlan = {
      ...plan,
      profileId: input.profileId,
      status: "approved",
    };
    parsed.sections[section] = { plan: JSON.stringify(approved) };
    await writeParsedConfigIni(parsed.global, parsed.sections);
    return approved;
  });
  credentialWrite = write.then(
    () => undefined,
    () => undefined
  );
  return write;
}

export function completeToolSetup(
  orgId: string,
  plan: ToolSetupPlan,
  toolId: string
): Promise<void> {
  const write = credentialWrite.then(async () => {
    const parsed = await readConfig();
    const staged = credentialSection(orgId, plan.id);
    if (plan.requiresApiKey) {
      const credential = parsed.sections[staged];
      if (!(credential?.api_key_enc || credential?.api_key)) {
        throw new Error(
          "The API key is missing. Configure the tool before using it."
        );
      }
      parsed.sections[credentialSection(orgId, toolId)] = credential;
      delete parsed.sections[staged];
    }
    parsed.sections[setupSection(orgId, plan.id)] = {
      plan: JSON.stringify({ ...plan, status: "ready", toolId }),
    };
    await writeParsedConfigIni(parsed.global, parsed.sections);
  });
  credentialWrite = write.catch(() => undefined);
  return write;
}

/**
 * Purge every org-scoped tool API key and setup plan. The config file is
 * rewritten in place and Nakama keeps no history of it, so a purge leaves no
 * shadow copy holding the secret; pre-deletion operator backups remain under
 * the operator's own retention policy.
 */
export function deleteOrgToolCredentials(orgId: string): Promise<void> {
  const write = credentialWrite.then(async () => {
    const parsed = await readConfig();
    let removed = false;
    for (const prefix of [CREDENTIAL_SECTION_PREFIX, SETUP_SECTION_PREFIX]) {
      for (const section of Object.keys(parsed.sections)) {
        if (!belongsToOrgSection(prefix, section, orgId)) {
          continue;
        }
        delete parsed.sections[section];
        removed = true;
      }
    }
    if (!removed) {
      return;
    }
    await writeParsedConfigIni(parsed.global, parsed.sections);
  });
  credentialWrite = write.catch(() => undefined);
  return write;
}

// Helpers shared by the custom tool loaders (javascript, python, and any
// future handler type registered in custom-tool-handlers.ts).

function createErrorTool(
  record: StoredToolRecord,
  message: string
): ToolDefinition {
  return {
    description: record.description,
    name: record.name,
    parameters: permissiveObjectSchema(),
    async run() {
      return { error: message };
    },
  };
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Shared load path for javascript/python subprocess tools. */
export async function loadCustomSubprocessTool(options: {
  allowParallelSafe?: boolean;
  record: StoredToolRecord;
  resolveModulePath: (modulePath: string) => string;
  run: (
    modulePath: string,
    input: unknown,
    context: ToolContext,
    apiKey?: string
  ) => Promise<unknown>;
  validateModule: (modulePath: string) => Promise<void>;
}): Promise<ToolDefinition | null> {
  const { allowParallelSafe, record, resolveModulePath, run, validateModule } =
    options;
  const config = readHandlerConfig(record.handlerConfig);

  if (!config?.modulePath) {
    return createErrorTool(
      record,
      `Tool "${record.name}" is missing handlerConfig.modulePath.`
    );
  }

  let modulePath: string;

  try {
    modulePath = resolveModulePath(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  // validateModule owns the missing-file check so load does not pathExists twice.
  try {
    await validateModule(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  return {
    description: record.description,
    name: record.name,
    parameters: config.parameters ?? permissiveObjectSchema(),
    ...(allowParallelSafe && config.parallelSafe ? { parallelSafe: true } : {}),
    async run(input, context) {
      if (record.orgId && record.orgId !== context.orgId) {
        throw new Error("Tool not available in this organization.");
      }
      if (!context.orgId) {
        if (config.requiresApiKey) {
          throw new Error("Organization context is required.");
        }
        return run(modulePath, input, context);
      }
      // A key saved from the playground reaches the tool even when the tool
      // was registered without requiresApiKey.
      const apiKey = await loadToolApiKey(context.orgId, record.id);
      if (!apiKey) {
        if (!config.requiresApiKey) {
          return run(modulePath, input, context);
        }
        return {
          orgId: context.orgId,
          toolId: record.id,
          toolName: record.name,
          type: "tool_credentials_required",
        };
      }
      // Keep accidental key echoes and subprocess errors out of chat and logs.
      const redact = (text: string) =>
        text
          .replaceAll(apiKey, "[REDACTED]")
          .replaceAll(JSON.stringify(apiKey).slice(1, -1), "[REDACTED]");
      const redactResult = (value: unknown): unknown => {
        if (typeof value === "string") {
          return redact(value);
        }
        if (Array.isArray(value)) {
          return value.map(redactResult);
        }
        if (value && typeof value === "object") {
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
              redact(key),
              redactResult(entry),
            ])
          );
        }
        return value;
      };
      try {
        const result = await run(modulePath, input, context, apiKey);
        return redactResult(result);
      } catch (error) {
        throw new Error(
          redact(error instanceof Error ? error.message : String(error))
        );
      }
    },
  };
}

function isPathInsideDirectory(
  targetPath: string,
  directoryPath: string
): boolean {
  const relative = path.relative(directoryPath, targetPath);

  return (
    relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative))
  );
}

interface CustomToolHandlerConfig {
  modulePath: string;
  parallelSafe?: boolean;
  parameters?: JsonSchema;
  requiresApiKey?: boolean;
}

function readHandlerConfig(
  handlerConfig: unknown
): CustomToolHandlerConfig | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const record = handlerConfig as Record<string, unknown>;
  const modulePath =
    typeof record.modulePath === "string" && record.modulePath.trim()
      ? record.modulePath.trim()
      : null;

  if (!modulePath) {
    return null;
  }

  const parameters = isJsonSchema(record.parameters)
    ? record.parameters
    : undefined;
  const parallelSafe = record.parallelSafe === true;

  return {
    modulePath,
    parallelSafe,
    parameters,
    requiresApiKey: record.requiresApiKey === true,
  };
}

export function readHandlerModulePath(handlerConfig: unknown): string | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const modulePath = (handlerConfig as Record<string, unknown>).modulePath;

  if (typeof modulePath !== "string" || !modulePath.trim()) {
    return null;
  }

  return modulePath.trim();
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

export function resolveCustomToolModulePath(modulePath: string): string {
  const toolsDir = path.resolve(getCustomToolsDir());
  const resolved = path.isAbsolute(modulePath)
    ? path.resolve(modulePath)
    : path.resolve(toolsDir, modulePath);

  if (!isPathInsideDirectory(resolved, toolsDir)) {
    throw new Error(`Tool module path must stay inside ${toolsDir}.`);
  }

  return resolved;
}
