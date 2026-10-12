import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  JsonSchema,
  JsonValue,
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
import type { DatabaseAdapter, StoredToolRecord } from "@nakama/db";
import { z } from "zod";
import { type ManagedSecrets, toolSecretEnvName } from "./managed-secrets";

const CREDENTIAL_SECTION_PREFIX = "tool-key.";

const SETUP_SECTION_PREFIX = "tool-setup.";

let toolSecrets: ManagedSecrets | null = null;

export function setToolSecrets(secrets: ManagedSecrets): void {
  toolSecrets = secrets;
}

function requireToolSecrets(): ManagedSecrets {
  if (!toolSecrets) {
    throw new Error("Tool secret store is not ready.");
  }

  return toolSecrets;
}

const ErrorCodeSchema = z.object({ code: z.string().optional() });

const JsonValueSchema = z.json();

const JsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      additionalProperties: z.union([z.boolean(), JsonSchemaSchema]).optional(),
      description: z.string().optional(),
      enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      items: JsonSchemaSchema.optional(),
      properties: z.record(z.string(), JsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      type: z.string().optional(),
    })
    .passthrough()
);

const HandlerConfigSchema = z
  .object({
    env: JsonValueSchema.optional(),
    modulePath: z.string().trim().min(1),
    parallelSafe: z.boolean().optional(),
    parameters: JsonSchemaSchema.optional(),
    requiresApiKey: z.boolean().optional(),
  })
  .passthrough();

const ToolSetupPlanSchema = z.object({
  createdAt: z.string().optional(),
  description: z.string(),
  id: z.string(),
  name: z.string(),
  plan: z.string(),
  profileId: z.string().optional(),
  requiresApiKey: z.boolean(),
  sessionId: z.string(),
  status: z.enum(["pending", "approved", "ready", "rejected"]),
  toolId: z.string().optional(),
});

function hasErrorCode(error: Error, code: string): boolean {
  return ErrorCodeSchema.safeParse(error).data?.code === code;
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
    if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
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
    if (!(error instanceof Error && hasErrorCode(error, "ENOENT"))) {
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
    if (!(error instanceof Error && hasErrorCode(error, "EEXIST"))) {
      throw error;
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

async function decryptToolEnv(
  orgId: string,
  credential: Record<string, string> | undefined
): Promise<Record<string, string>> {
  if (!credential?.env_enc) {
    return {};
  }

  return z
    .record(z.string(), z.string())
    .parse(JSON.parse(await decryptForOrg(orgId, credential.env_enc)));
}

export async function loadToolApiKey(
  orgId: string,
  toolId: string
): Promise<string | undefined> {
  return (
    (
      await requireToolSecrets().resolve(orgId, `tool:${toolId}`, [
        toolSecretEnvName(orgId, toolId),
      ])
    ).value ?? undefined
  );
}

export async function getToolApiKeyStatus(orgId: string, toolId: string) {
  const envName = toolSecretEnvName(orgId, toolId);

  return {
    ...(await requireToolSecrets().status(orgId, `tool:${toolId}`, [envName])),
    envName,
  };
}

export async function manageToolApiKey(
  orgId: string,
  toolId: string,
  action: "clear" | "use-stored"
) {
  const secrets = requireToolSecrets();

  if (action === "clear") {
    await secrets.delete(orgId, `tool:${toolId}`);
  } else {
    await secrets.useStored(orgId, `tool:${toolId}`, [
      toolSecretEnvName(orgId, toolId),
    ]);
  }

  return getToolApiKeyStatus(orgId, toolId);
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

function validateApiKey(value: string | undefined): string {
  if (
    value === undefined ||
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
  value: string
): Promise<void> {
  const apiKey = validateApiKey(value);

  const write = credentialWrite.then(() =>
    requireToolSecrets().save(orgId, `tool:${toolId}`, apiKey, [
      toolSecretEnvName(orgId, toolId),
    ])
  );

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
  value: JsonValue | undefined
): ToolEnvVar[] {
  if (value === undefined) {
    return [];
  }

  let entries: JsonValue[];

  try {
    entries = z.array(JsonValueSchema).parse(value);
  } catch {
    throw new NakamaApiError(
      "handlerConfig.env must be a list of up to 20 variables.",
      400
    );
  }

  if (entries.length > 20) {
    throw new NakamaApiError(
      "handlerConfig.env must be a list of up to 20 variables.",
      400
    );
  }

  const seen = new Set<string>();

  return entries.map((entry) => {
    const record = z
      .object({ name: z.string().optional(), secret: z.boolean().optional() })
      .passthrough()
      .safeParse(entry);

    const name = record.success ? (record.data.name?.trim() ?? "") : "";

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

    seen.add(name);

    return { name, secret: record.success && record.data.secret === true };
  });
}

export function readToolEnvDeclarations(
  handlerConfig: StoredToolRecord["handlerConfig"]
): ToolEnvVar[] {
  try {
    const config = z.record(z.string(), JsonValueSchema).parse(handlerConfig);

    return parseToolEnvDeclarations(config.env);
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

function credentialSection(orgId: string, toolId: string): string {
  return encodeOrgScopedSection(CREDENTIAL_SECTION_PREFIX, orgId, toolId);
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

  const plan = ToolSetupPlanSchema.parse(JSON.parse(value));

  return isExpiredToolSetup(plan) ? rejectToolSetup(orgId, setupId) : plan;
}

const TOOL_SETUP_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function isExpiredToolSetup(plan: ToolSetupPlan): boolean {
  return (
    (plan.status === "pending" || plan.status === "approved") &&
    !!plan.createdAt &&
    Date.now() - Date.parse(plan.createdAt) > TOOL_SETUP_LIFETIME_MS
  );
}

export function rejectToolSetup(
  orgId: string,
  setupId: string
): Promise<ToolSetupPlan> {
  const write = credentialWrite.then(async () => {
    const parsed = await readConfig();
    const section = setupSection(orgId, setupId);
    const value = parsed.sections[section]?.plan;

    if (!value) {
      throw new NakamaApiError("Tool setup not found.", 404);
    }

    const plan = ToolSetupPlanSchema.parse(JSON.parse(value));

    if (plan.status === "ready") {
      throw new NakamaApiError("Tool setup is complete.", 409);
    }

    await requireToolSecrets().delete(orgId, `tool:${setupId}`);
    const rejected: ToolSetupPlan = { ...plan, status: "rejected" };
    parsed.sections[section] = { plan: JSON.stringify(rejected) };
    await writeParsedConfigIni(parsed.global, parsed.sections);

    return rejected;
  });

  credentialWrite = write.then(
    () => undefined,
    () => undefined
  );

  return write;
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

    const plan = ToolSetupPlanSchema.parse(JSON.parse(value));

    if (isExpiredToolSetup(plan)) {
      await requireToolSecrets().delete(orgId, `tool:${setupId}`);
      parsed.sections[section] = {
        plan: JSON.stringify({ ...plan, status: "rejected" }),
      };
      await writeParsedConfigIni(parsed.global, parsed.sections);
      throw new NakamaApiError("Tool setup expired.", 410);
    }

    if (plan.status !== "pending") {
      return plan;
    }

    if (plan.requiresApiKey) {
      await requireToolSecrets().save(
        orgId,
        `tool:${setupId}`,
        validateApiKey(input.apiKey)
      );
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
    const current = parsed.sections[setupSection(orgId, plan.id)]?.plan;

    if (
      !current ||
      ToolSetupPlanSchema.parse(JSON.parse(current)).status !== "approved"
    ) {
      throw new NakamaApiError("Tool setup is not approved.", 409);
    }

    if (plan.requiresApiKey) {
      const credential = await requireToolSecrets().resolve(
        orgId,
        `tool:${plan.id}`
      );

      if (!credential.value) {
        throw new Error(
          "The API key is missing. Configure the tool before using it."
        );
      }

      await requireToolSecrets().save(
        orgId,
        `tool:${toolId}`,
        credential.value
      );
      await requireToolSecrets().delete(orgId, `tool:${plan.id}`);
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
export function deleteOrgToolCredentials(
  orgId: string,
  databaseAdapter: DatabaseAdapter
): Promise<void> {
  const write = credentialWrite.then(async () => {
    for (const secret of await databaseAdapter.listManagedSecrets()) {
      if (secret.scope === orgId && secret.name.startsWith("tool:")) {
        await databaseAdapter.deleteManagedSecret(orgId, secret.name);
      }
    }

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

export function readOptionalString(
  value: string | undefined
): string | undefined {
  return value || undefined;
}

/**
 * A tool published to a team is loaded with `orgId` rewritten to the consumer
 * so credentials and the ownership guard use the consumer; `moduleOrgId` keeps
 * the owner, whose directory still holds the module.
 */
export type CustomToolRecord = StoredToolRecord & {
  moduleOrgId?: string | null;
};

/** Shared load path for javascript/python subprocess tools. */
export async function loadCustomSubprocessTool(options: {
  allowParallelSafe?: boolean;
  record: CustomToolRecord;
  resolveModulePath: (modulePath: string, orgId?: string | null) => string;
  run: (
    modulePath: string,
    input: JsonValue,
    context: ToolContext,
    env?: Record<string, string>
  ) => Promise<JsonValue | undefined>;
  validateModule: (modulePath: string, orgId?: string | null) => Promise<void>;
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
    modulePath = resolveModulePath(
      config.modulePath,
      record.moduleOrgId ?? record.orgId
    );
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  // validateModule owns the missing-file check so load does not pathExists twice.
  try {
    await validateModule(config.modulePath, record.moduleOrgId ?? record.orgId);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  const tool: ToolDefinition = {
    description: record.description,
    name: record.name,
    parameters: config.parameters ?? permissiveObjectSchema(),
    async run(input, context) {
      const toolInput = z.record(z.string(), JsonValueSchema).parse(input);

      if (!record.orgId || record.orgId !== context.orgId) {
        throw new Error("Tool not available in this organization.");
      }

      const needsCredentials = config.requiresApiKey || config.env.length > 0;

      if (!context.orgId) {
        if (needsCredentials) {
          throw new Error("Organization context is required.");
        }

        return run(modulePath, toolInput, context);
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

      const redactResult = (value: JsonValue): JsonValue => {
        const text = z.string().safeParse(value);

        if (text.success) {
          return redact(text.data);
        }

        if (Array.isArray(value)) {
          return value.map(redactResult);
        }

        const record = z.record(z.string(), JsonValueSchema).safeParse(value);

        if (record.success) {
          return Object.fromEntries(
            Object.entries(record.data).map(([key, entry]) => [
              redact(key),
              redactResult(entry),
            ])
          );
        }

        return value;
      };

      try {
        const result = JsonValueSchema.optional().parse(
          await run(modulePath, toolInput, context, env)
        );

        return result === undefined || secrets.length === 0
          ? result
          : redactResult(result);
      } catch (error) {
        const redacted = new Error(
          redact(error instanceof Error ? error.message : String(error))
        );

        // Retry classification reads these off the thrown error.
        if (error instanceof Object && "retryable" in error) {
          Object.assign(redacted, { retryable: error.retryable });
        }

        throw redacted;
      }
    },
  };

  if (allowParallelSafe && config.parallelSafe) {
    tool.parallelSafe = true;
  }

  return tool;
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

export function readHandlerConfig(
  handlerConfig: StoredToolRecord["handlerConfig"]
): CustomToolHandlerConfig | null {
  const parsed = HandlerConfigSchema.safeParse(handlerConfig);

  if (!parsed.success) {
    return null;
  }

  return {
    env: readToolEnvDeclarations(parsed.data),
    modulePath: parsed.data.modulePath,
    parallelSafe: parsed.data.parallelSafe,
    parameters: parsed.data.parameters,
    requiresApiKey: parsed.data.requiresApiKey,
  };
}

export function readHandlerModulePath(
  handlerConfig: StoredToolRecord["handlerConfig"]
): string | null {
  return HandlerConfigSchema.safeParse(handlerConfig).data?.modulePath ?? null;
}

export function resolveCustomToolModulePath(
  modulePath: string,
  orgId?: string | null
): string {
  const toolsDir = path.resolve(getCustomToolsDir(orgId ?? undefined));

  const resolved = path.isAbsolute(modulePath)
    ? path.resolve(modulePath)
    : path.resolve(toolsDir, modulePath);

  if (!isPathInsideDirectory(resolved, toolsDir)) {
    throw new Error(`Tool module path must stay inside ${toolsDir}.`);
  }

  return resolved;
}
