import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonSchema, ToolDefinition, ToolSetupPlan } from "@nakama/core";
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

export type CustomToolJsonValue =
  | boolean
  | null
  | number
  | string
  | CustomToolJsonValue[]
  | { [key: string]: CustomToolJsonValue };

export function parseCustomToolJsonValue<T>(value: T): CustomToolJsonValue {
  if (value === null || value === true || value === false || isString(value)) {
    return value;
  }

  if (isFiniteNumber(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(parseCustomToolJsonValue);
  }

  if (!(value instanceof Object)) {
    throw new Error("Custom tool values must be JSON serializable.");
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Custom tool values must be JSON serializable.");
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      parseCustomToolJsonValue(entry),
    ])
  );
}

function isFiniteNumber<T>(value: T): value is T & number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    !(value instanceof Number) &&
    Number.isFinite(value)
  );
}

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
  } catch (cause) {
    if (getNodeErrorCode(cause) === "ENOENT") {
      return { global: {}, sections: {} };
    }

    throw cause;
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
  } catch (cause) {
    if (getNodeErrorCode(cause) !== "ENOENT") {
      throw cause;
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
  } catch (cause) {
    if (getNodeErrorCode(cause) !== "EEXIST") {
      throw cause;
    }

    return Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64url");
  }
}

async function encryptForOrg(
  orgId: string,
  plaintext: string
): Promise<string> {
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
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url"
  );
}

async function decryptForOrg(orgId: string, value: string): Promise<string> {
  const encoded = Buffer.from(value, "base64url");

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

async function encryptToolApiKey(
  orgId: string,
  apiKey: string
): Promise<Record<string, string>> {
  return { api_key_enc: await encryptForOrg(orgId, apiKey) };
}

async function decryptToolApiKey(
  orgId: string,
  credential: Record<string, string> | undefined
): Promise<string | undefined> {
  if (!credential?.api_key_enc) {
    // Keys saved before encryption stay readable until the next save.
    return credential?.api_key;
  }

  return decryptForOrg(orgId, credential.api_key_enc);
}

async function decryptToolEnv(
  orgId: string,
  credential: Record<string, string> | undefined
): Promise<Record<string, string>> {
  if (!credential?.env_enc) {
    return {};
  }

  const parsed: unknown = JSON.parse(
    await decryptForOrg(orgId, credential.env_enc)
  );

  if (!isToolEnvironment(parsed)) {
    return {};
  }

  return parsed;
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

export async function loadToolEnv(
  orgId: string,
  toolId: string
): Promise<Record<string, string>> {
  return decryptToolEnv(
    orgId,
    (await readConfig()).sections[credentialSection(orgId, toolId)]
  );
}

let credentialWrite: Promise<void> = Promise.resolve();

function validateApiKey(value: string): string {
  if (!value.trim() || value.length > 8192 || /[\r\n\0]/.test(value)) {
    throw new NakamaApiError("Enter a valid API key.", 400);
  }

  return value.trim();
}

export function saveToolApiKey(
  orgId: string,
  toolId: string,
  value: string
): Promise<void> {
  const apiKey = validateApiKey(value);

  const write = credentialWrite.then(async () => {
    const encrypted = await encryptToolApiKey(orgId, apiKey);
    const parsed = await readConfig();
    const section = credentialSection(orgId, toolId);
    const { api_key: _legacy, ...existing } = parsed.sections[section] ?? {};
    parsed.sections[section] = { ...existing, ...encrypted };
    await writeParsedConfigIni(parsed.global, parsed.sections);
  });

  credentialWrite = write.catch(() => undefined);

  return write;
}

/**
 * Names a tool may declare in handlerConfig.env. Names that change how the
 * interpreter starts (PATH, NODE_OPTIONS, PYTHONPATH, LD_PRELOAD, ...) or
 * that Nakama itself sets are refused, so a saved value cannot load code.
 */
const TOOL_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

const BLOCKED_TOOL_ENV_PREFIXES = [
  "BUN_",
  "DYLD_",
  "LD_",
  "NAKAMA_",
  "NODE_",
  "NPM_",
  "PYTHON",
];

const BLOCKED_TOOL_ENV_NAMES = new Set([
  "COMSPEC",
  "HOME",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
]);

export interface ToolEnvVar {
  name: string;
  secret: boolean;
}

/** Reads and validates handlerConfig.env. Throws on any invalid entry. */
export function parseToolEnvDeclarations(
  value: unknown[] | undefined
): ToolEnvVar[] {
  if (value === undefined) {
    return [];
  }

  if (value.length > 20) {
    throw new NakamaApiError(
      "handlerConfig.env must be a list of up to 20 variables.",
      400
    );
  }

  const seen = new Set<string>();

  return value.map((entry) => {
    const record =
      entry instanceof Object && !Array.isArray(entry)
        ? new Map(Object.entries(entry))
        : new Map<string, unknown>();

    const nameValue = record.get("name");
    const name = isString(nameValue) ? nameValue.trim() : "";

    if (
      !TOOL_ENV_NAME_PATTERN.test(name) ||
      BLOCKED_TOOL_ENV_NAMES.has(name) ||
      BLOCKED_TOOL_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
      seen.has(name)
    ) {
      throw new NakamaApiError(
        `handlerConfig.env name "${name}" is not allowed. Use unique UPPER_SNAKE_CASE names that are not system or NAKAMA_ variables.`,
        400
      );
    }

    const secret = record.get("secret");

    if (
      secret !== undefined &&
      Object.prototype.toString.call(secret) !== "[object Boolean]"
    ) {
      throw new NakamaApiError(
        "handlerConfig.env[].secret must be a boolean.",
        400
      );
    }

    seen.add(name);

    return { name, secret: secret === true };
  });
}

export function readToolEnvDeclarations<T>(handlerConfig: T): ToolEnvVar[] {
  try {
    if (!(handlerConfig instanceof Object) || Array.isArray(handlerConfig)) {
      return [];
    }

    const value = new Map(Object.entries(handlerConfig)).get("env");

    return Array.isArray(value) ? parseToolEnvDeclarations(value) : [];
  } catch {
    return [];
  }
}

/** Merges the given values into the tool's saved environment. */
export function saveToolEnv(
  orgId: string,
  toolId: string,
  declared: ToolEnvVar[],
  values: Record<string, string>
): Promise<void> {
  const names = new Set(declared.map((entry) => entry.name));
  const updates: Record<string, string> = {};

  for (const [name, value] of Object.entries(values)) {
    if (!names.has(name)) {
      throw new NakamaApiError(`${name} is not a variable of this tool.`, 400);
    }

    if (!value.trim() || value.length > 8192 || /[\r\n\0]/.test(value)) {
      throw new NakamaApiError(`Enter a valid value for ${name}.`, 400);
    }

    updates[name] = value.trim();
  }

  const write = credentialWrite.then(async () => {
    const parsed = await readConfig();
    const section = credentialSection(orgId, toolId);
    const existing = parsed.sections[section] ?? {};
    const env = { ...(await decryptToolEnv(orgId, existing)), ...updates };
    parsed.sections[section] = {
      ...existing,
      env_enc: await encryptForOrg(orgId, JSON.stringify(env)),
    };
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

  const parsed: unknown = JSON.parse(value);

  if (!isToolSetupPlan(parsed)) {
    throw new Error("Tool setup plan is invalid.");
  }

  return parsed;
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

    const parsedPlan: unknown = JSON.parse(value);

    if (!isToolSetupPlan(parsedPlan)) {
      throw new Error("Tool setup plan is invalid.");
    }

    const plan = parsedPlan;

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

export function readOptionalString<T>(value: T): string | undefined {
  return isString(value) && value ? value : undefined;
}

/** Shared load path for javascript/python subprocess tools. */
interface LoadCustomSubprocessToolOptions {
  allowParallelSafe?: boolean;
  record: StoredToolRecord;
  resolveModulePath: (modulePath: string) => string;
  run: ToolDefinition["run"];
  validateModule: (modulePath: string) => Promise<void>;
}

export async function loadCustomSubprocessTool(
  options: LoadCustomSubprocessToolOptions
): Promise<ToolDefinition | null> {
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

  const definition: ToolDefinition = {
    description: record.description,
    name: record.name,
    parameters: config.parameters ?? permissiveObjectSchema(),
    async run(input, context) {
      if (record.orgId && record.orgId !== context.orgId) {
        throw new Error("Tool not available in this organization.");
      }

      const needsCredentials = config.requiresApiKey || config.env.length > 0;

      if (!context.orgId) {
        if (needsCredentials) {
          throw new Error("Organization context is required.");
        }

        return run(modulePath, input, context);
      }

      // A key saved from the playground reaches the tool even when the tool
      // was registered without requiresApiKey.
      const apiKey = await loadToolApiKey(context.orgId, record.id);
      const saved = await loadToolEnv(context.orgId, record.id);

      const missing = config.env
        .map((entry) => entry.name)
        .filter((name) => !saved[name]);

      if ((config.requiresApiKey && !apiKey) || missing.length > 0) {
        return {
          missing,
          orgId: context.orgId,
          toolId: record.id,
          toolName: record.name,
          type: "tool_credentials_required",
        };
      }

      const env: Record<string, string> = {};

      for (const entry of config.env) {
        env[entry.name] = saved[entry.name]!;
      }

      if (apiKey) {
        env.NAKAMA_TOOL_API_KEY = apiKey;
      }

      // Keep accidental secret echoes and subprocess errors out of chat and
      // logs. Plain values such as URLs stay readable.
      const secrets = [
        ...(apiKey ? [apiKey] : []),
        ...config.env
          .filter((entry) => entry.secret)
          .map((entry) => env[entry.name]!),
      ];

      const redact = (text: string) =>
        secrets.reduce(
          (current, secret) =>
            current
              .replaceAll(secret, "[REDACTED]")
              .replaceAll(JSON.stringify(secret).slice(1, -1), "[REDACTED]"),
          text
        );

      const redactResult = (value: JsonToolValue): JsonToolValue => {
        if (isString(value)) {
          return redact(value);
        }

        if (Array.isArray(value)) {
          return value.map(redactResult);
        }

        if (value instanceof Object) {
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
        const result = await run(modulePath, input, context, env);

        if (secrets.length === 0) {
          return result;
        }

        if (!isJsonToolValue(result)) {
          throw new Error(
            "Tool returned a value that cannot be redacted safely."
          );
        }

        return redactResult(result);
      } catch (error) {
        throw new Error(
          redact(error instanceof Error ? error.message : String(error))
        );
      }
    },
  };

  if (allowParallelSafe && config.parallelSafe) {
    definition.parallelSafe = true;
  }

  return definition;
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
  env: ToolEnvVar[];
  modulePath: string;
  parallelSafe?: boolean;
  parameters?: JsonSchema;
  requiresApiKey?: boolean;
}

type JsonToolValue =
  | boolean
  | null
  | number
  | string
  | JsonToolValue[]
  | { [key: string]: JsonToolValue };

function readHandlerConfig<T>(
  handlerConfig: T
): CustomToolHandlerConfig | null {
  if (!(handlerConfig instanceof Object) || Array.isArray(handlerConfig)) {
    return null;
  }

  const record = new Map(Object.entries(handlerConfig));
  const rawModulePath = record.get("modulePath");

  const modulePath =
    isString(rawModulePath) && rawModulePath.trim()
      ? rawModulePath.trim()
      : null;

  if (!modulePath) {
    return null;
  }

  const rawParameters = record.get("parameters");
  const parameters = isJsonSchema(rawParameters) ? rawParameters : undefined;

  const parallelSafe = record.get("parallelSafe") === true;

  return {
    env: readToolEnvDeclarations(handlerConfig),
    modulePath,
    parallelSafe,
    parameters,
    requiresApiKey: record.get("requiresApiKey") === true,
  };
}

function isToolSetupPlan(value: unknown): value is ToolSetupPlan {
  if (!(value instanceof Object) || Array.isArray(value)) {
    return false;
  }

  const plan = new Map(Object.entries(value));
  const status = plan.get("status");

  return (
    isString(plan.get("description")) &&
    isString(plan.get("id")) &&
    isString(plan.get("name")) &&
    isString(plan.get("plan")) &&
    isString(plan.get("sessionId")) &&
    Object.prototype.toString.call(plan.get("requiresApiKey")) ===
      "[object Boolean]" &&
    (status === "pending" || status === "approved" || status === "ready") &&
    (plan.get("profileId") === undefined || isString(plan.get("profileId"))) &&
    (plan.get("toolId") === undefined || isString(plan.get("toolId")))
  );
}

export function readHandlerModulePath<T>(handlerConfig: T): string | null {
  if (!(handlerConfig instanceof Object) || Array.isArray(handlerConfig)) {
    return null;
  }

  const modulePath = new Map(Object.entries(handlerConfig)).get("modulePath");

  if (!(isString(modulePath) && modulePath.trim())) {
    return null;
  }

  return modulePath.trim();
}

export function isJsonSchema<T>(value: T): value is T & JsonSchema {
  return value instanceof Object && !Array.isArray(value);
}

function getNodeErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Object && "code" in cause)) {
    return;
  }

  return isString(cause.code) ? cause.code : undefined;
}

function isToolEnvironment(value: unknown): value is Record<string, string> {
  return (
    value instanceof Object &&
    !Array.isArray(value) &&
    Object.values(value).every(isString)
  );
}

function isJsonToolValue(value: unknown): value is JsonToolValue {
  if (value === null || value === true || value === false || isString(value)) {
    return true;
  }

  if (
    Object.prototype.toString.call(value) === "[object Number]" &&
    !(value instanceof Number)
  ) {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonToolValue);
  }

  return value instanceof Object && Object.values(value).every(isJsonToolValue);
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

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
