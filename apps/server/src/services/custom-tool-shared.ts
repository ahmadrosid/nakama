import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  JsonSchema,
  ToolContext,
  ToolDefinition,
  ToolSetupPlan,
} from "@nakama/core";
import {
  getCustomToolsDir,
  getUserConfigPath,
  NakamaApiError,
  parseIniWithSections,
  permissiveObjectSchema,
  writeParsedConfigIni,
} from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";

function credentialSection(orgId: string, toolId: string): string {
  return `tool-key.${Buffer.from(JSON.stringify([orgId, toolId])).toString("base64url")}`;
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

export async function loadToolApiKey(
  orgId: string,
  toolId: string
): Promise<string | undefined> {
  return (await readConfig()).sections[credentialSection(orgId, toolId)]
    ?.api_key;
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
    const parsed = await readConfig();
    parsed.sections[credentialSection(orgId, toolId)] = { api_key: apiKey };
    await writeParsedConfigIni(parsed.global, parsed.sections);
  });
  credentialWrite = write.catch(() => undefined);
  return write;
}

function setupSection(orgId: string, setupId: string): string {
  return `tool-setup.${Buffer.from(JSON.stringify([orgId, setupId])).toString("base64url")}`;
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
      parsed.sections[credentialSection(orgId, setupId)] = {
        api_key: validateApiKey(input.apiKey),
      };
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
      if (!credential?.api_key) {
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
      if (!config.requiresApiKey) {
        return run(modulePath, input, context);
      }
      if (!context.orgId) {
        throw new Error("Organization context is required.");
      }
      const apiKey = await loadToolApiKey(context.orgId, record.id);
      if (!apiKey) {
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
