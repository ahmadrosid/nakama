import { isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { assertConfigPathSegment } from "./soul/resolve";
import { getUserConfigDir } from "./user-config";

export const PLUGIN_MANIFEST_API_VERSION = 1;

export const PLUGIN_TOOL_NAME_MAX_LENGTH = 64;

export const PLUGIN_MANIFEST_FILENAME = "nakama.plugin.json";

const PLUGIN_PACKAGES_DIR_NAME = "plugins";

const PLUGIN_STAGING_DIR_NAME = ".staging";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

const CONTRIBUTION_KEY = /^[a-z][a-z0-9_-]*$/;

interface PluginJsonSchema {
  additionalProperties?: boolean | PluginJsonSchema;
  enum?: Array<boolean | null | number | string>;
  exclusiveMaximum?: number;
  exclusiveMinimum?: number;
  items?: PluginJsonSchema;
  maxItems?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  minimum?: number;
  minLength?: number;
  properties?: Record<string, PluginJsonSchema>;
  required?: string[];
  type?: z.infer<typeof JsonSchemaType> | Array<z.infer<typeof JsonSchemaType>>;
}

const JsonSchemaType = z.enum([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

const JsonSchemaValue: z.ZodType<PluginJsonSchema> = z.lazy(() =>
  z
    .object({
      additionalProperties: z.union([z.boolean(), JsonSchemaValue]).optional(),
      enum: z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .min(1)
        .optional(),
      exclusiveMaximum: z.number().finite().optional(),
      exclusiveMinimum: z.number().finite().optional(),
      items: JsonSchemaValue.optional(),
      maxItems: z.number().finite().optional(),
      maximum: z.number().finite().optional(),
      maxLength: z.number().finite().optional(),
      minItems: z.number().finite().optional(),
      minimum: z.number().finite().optional(),
      minLength: z.number().finite().optional(),
      properties: z.record(z.string(), JsonSchemaValue).optional(),
      required: z.array(z.string()).optional(),
      type: z
        .union([JsonSchemaType, z.array(JsonSchemaType).min(1)])
        .optional(),
    })
    .strict()
);

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PluginActionAccess = "admin" | "member";

export type PluginActionEffect = "read" | "write";

export type OrgPluginLifecycleState =
  | "disabled"
  | "disabling"
  | "enabled"
  | "enabling"
  | "retained"
  | "updating";

export type PluginManifestValidationCode =
  | "duplicate_key"
  | "invalid_identity"
  | "invalid_path"
  | "invalid_version"
  | "missing_field"
  | "undeclared_entrypoint"
  | "unsupported_api"
  | "unsupported_hooks"
  | "unsupported_schema";

export interface PluginSkillContribution {
  directory: string;
  key: string;
}

export interface PluginActionContribution {
  access: PluginActionAccess;
  description: string;
  effect: PluginActionEffect;
  entry: string;
  exposeAsTool?: boolean;
  inputSchema: unknown;
  key: string;
}

export interface PluginUiContribution {
  assetsDir: string;
  entryModule: string;
  pageLabel: string;
}

export interface PluginMigrationContribution {
  id: string;
  path: string;
}

export interface PluginWorkerContribution {
  /** Bundled Bun entry, run as a supervised process per organization. */
  entry: string;
  key: string;
  name: string;
  useHostLlm?: boolean;
}

export interface PluginManifest {
  actions: PluginActionContribution[];
  apiVersion: typeof PLUGIN_MANIFEST_API_VERSION;
  author: string;
  database?: { migrations: PluginMigrationContribution[] };
  description: string;
  /** HTTPS URL of the plugin's display icon. */
  icon?: string;
  id: string;
  license: string;
  minNakamaVersion: string;
  name: string;
  skills: PluginSkillContribution[];
  ui?: PluginUiContribution;
  version: string;
  workers?: PluginWorkerContribution[];
}

export type PluginValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { code: PluginManifestValidationCode; ok: false };

export type PluginSchemaValidationResult =
  | { ok: true }
  | { code: "unsupported_schema"; ok: false };

export type PluginInstanceValidationResult =
  | { ok: true }
  | { code: "invalid_input"; ok: false };

export type PluginActorRole = "admin" | "member" | "viewer";

export interface PluginExecutionActor {
  id: string;
  role: PluginActorRole;
}

export interface PluginExecutionContext {
  actionKey?: string;
  actor: PluginExecutionActor;
  apiVersion: typeof PLUGIN_MANIFEST_API_VERSION;
  databasePath?: string;
  dataDir: string;
  invocationId: string;
  orgId: string;
  pluginId: string;
  pluginVersion: string;
  profileId?: string;
  sessionId?: string;
  workspaceRoot?: string;
}

export function validatePluginManifest(
  input: JsonValue
): PluginValidationResult {
  const parsed = z.record(z.string(), JsonValueSchema).safeParse(input);

  if (!parsed.success) {
    return fail("invalid_identity");
  }

  const value = parsed.data;

  if (value.apiVersion !== PLUGIN_MANIFEST_API_VERSION) {
    return fail("unsupported_api");
  }

  if (
    !(
      isNonEmptyString(value.id) &&
      PLUGIN_ID.test(value.id) &&
      isNonEmptyString(value.name) &&
      isNonEmptyString(value.description) &&
      isNonEmptyString(value.author) &&
      isNonEmptyString(value.license)
    )
  ) {
    return fail("invalid_identity");
  }

  if (
    !(
      isNonEmptyString(value.version) &&
      SEMVER.test(value.version) &&
      isNonEmptyString(value.minNakamaVersion) &&
      SEMVER.test(value.minNakamaVersion)
    )
  ) {
    return fail("invalid_version");
  }

  const icon = z.string().max(2048).safeParse(value.icon);

  if (
    value.icon !== undefined &&
    (!(icon.success && URL.canParse(icon.data)) ||
      new URL(icon.data).protocol !== "https:")
  ) {
    return fail("invalid_identity");
  }

  const workersResult = parseWorkers(value.workers);

  if (!workersResult.ok) {
    return workersResult;
  }

  const skillsResult = parseSkills(value.skills);

  if (!skillsResult.ok) {
    return skillsResult;
  }

  const actionsResult = parseActions(value.actions);

  if (!actionsResult.ok) {
    return actionsResult;
  }

  const uiResult = parseUi(value.ui);

  if (!uiResult.ok) {
    return uiResult;
  }

  const databaseResult = parseDatabase(value.database);

  if (!databaseResult.ok) {
    return databaseResult;
  }

  if (value.hooks !== undefined) {
    return fail("unsupported_hooks");
  }

  const manifest: PluginManifest = {
    actions: actionsResult.actions,
    apiVersion: PLUGIN_MANIFEST_API_VERSION,
    author: value.author,
    description: value.description,
    id: value.id,
    license: value.license,
    minNakamaVersion: value.minNakamaVersion,
    name: value.name,
    skills: skillsResult.skills,
    version: value.version,
  };

  if (workersResult.workers.length) {
    manifest.workers = workersResult.workers;
  }

  if (databaseResult.database) {
    manifest.database = databaseResult.database;
  }

  if (icon.success && value.icon !== undefined) {
    manifest.icon = icon.data;
  }

  if (uiResult.ui) {
    manifest.ui = uiResult.ui;
  }

  return { manifest, ok: true };
}

export function validatePluginJsonSchema(
  input: JsonValue
): PluginSchemaValidationResult {
  return JsonSchemaValue.safeParse(input).success
    ? { ok: true }
    : { code: "unsupported_schema", ok: false };
}

export function validatePluginJsonInstance(
  schemaInput: JsonValue,
  rawInput: JsonValue
): PluginInstanceValidationResult {
  const schemaResult = JsonSchemaValue.safeParse(schemaInput);
  const inputResult = JsonValueSchema.safeParse(rawInput);

  if (!(schemaResult.success && inputResult.success)) {
    return { code: "invalid_input", ok: false };
  }

  const schema = schemaResult.data;
  const input = inputResult.data;

  if (!matchesSchemaType(schema.type, input)) {
    return { code: "invalid_input", ok: false };
  }

  if (
    schema.enum !== undefined &&
    !schema.enum.some((item) => Object.is(item, input))
  ) {
    return { code: "invalid_input", ok: false };
  }

  const text = z.string().safeParse(input);

  if (
    text.success &&
    ((schema.minLength !== undefined && text.data.length < schema.minLength) ||
      (schema.maxLength !== undefined && text.data.length > schema.maxLength))
  ) {
    return { code: "invalid_input", ok: false };
  }

  const number = z.number().finite().safeParse(input);

  if (number.success) {
    if (schema.minimum !== undefined && number.data < schema.minimum) {
      return { code: "invalid_input", ok: false };
    }

    if (schema.maximum !== undefined && number.data > schema.maximum) {
      return { code: "invalid_input", ok: false };
    }

    if (
      schema.exclusiveMinimum !== undefined &&
      number.data <= schema.exclusiveMinimum
    ) {
      return { code: "invalid_input", ok: false };
    }

    if (
      schema.exclusiveMaximum !== undefined &&
      number.data >= schema.exclusiveMaximum
    ) {
      return { code: "invalid_input", ok: false };
    }
  }

  const array = z.array(z.unknown()).safeParse(input);

  if (array.success) {
    if (
      (schema.minItems !== undefined && array.data.length < schema.minItems) ||
      (schema.maxItems !== undefined && array.data.length > schema.maxItems)
    ) {
      return { code: "invalid_input", ok: false };
    }

    if (schema.items !== undefined) {
      for (const item of array.data) {
        if (!validatePluginJsonInstance(schema.items, item).ok) {
          return { code: "invalid_input", ok: false };
        }
      }
    }
  }

  const object = z.record(z.string(), z.unknown()).safeParse(input);

  if (object.success && matchesObjectType(schema.type)) {
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!Object.hasOwn(object.data, key)) {
          return { code: "invalid_input", ok: false };
        }
      }
    }

    const properties = schema.properties ?? {};

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(object.data, key)) {
        continue;
      }

      if (!validatePluginJsonInstance(propertySchema, object.data[key]).ok) {
        return { code: "invalid_input", ok: false };
      }
    }

    const extraKeys = Object.keys(object.data).filter(
      (key) => !(key in properties)
    );

    if (schema.additionalProperties === false && extraKeys.length > 0) {
      return { code: "invalid_input", ok: false };
    }

    if (isRecord(schema.additionalProperties)) {
      for (const key of extraKeys) {
        if (
          !validatePluginJsonInstance(
            schema.additionalProperties,
            object.data[key]
          ).ok
        ) {
          return { code: "invalid_input", ok: false };
        }
      }
    }
  }

  return { ok: true };
}

export function getPluginsRootDir(configDir = getUserConfigDir()): string {
  return join(assertAbsoluteConfigDir(configDir), PLUGIN_PACKAGES_DIR_NAME);
}

export function getPluginStagingRootDir(
  configDir = getUserConfigDir()
): string {
  return join(getPluginsRootDir(configDir), PLUGIN_STAGING_DIR_NAME);
}

export function getPluginReleaseDir(
  pluginId: string,
  version: string,
  configDir = getUserConfigDir()
): string {
  return join(
    getPluginsRootDir(configDir),
    assertConfigPathSegment(pluginId, "pluginId"),
    assertConfigPathSegment(version, "version")
  );
}

export function getOrgPluginDataDir(
  orgId: string,
  pluginId: string,
  configDir = getUserConfigDir()
): string {
  return join(
    assertAbsoluteConfigDir(configDir),
    "orgs",
    assertConfigPathSegment(orgId, "orgId"),
    PLUGIN_PACKAGES_DIR_NAME,
    assertConfigPathSegment(pluginId, "pluginId")
  );
}

export function getOrgPluginDatabasePath(
  orgId: string,
  pluginId: string,
  databaseGeneration: string,
  configDir = getUserConfigDir()
): string {
  return join(
    getOrgPluginDataDir(orgId, pluginId, configDir),
    "db",
    `${assertConfigPathSegment(databaseGeneration, "databaseGeneration")}.sqlite`
  );
}

export function resolvePluginReleaseEntry(
  releaseDir: string,
  entry: string
): string {
  if (!isAbsolute(releaseDir)) {
    throw new Error(
      "releaseDir must be an absolute path; relative paths resolve against process.cwd() and break plugin isolation."
    );
  }

  if (!isRelativePluginPath(entry)) {
    throw new Error("plugin entry must stay inside the release root.");
  }

  const root = resolve(releaseDir);
  const resolved = resolve(root, entry);

  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error("plugin entry must stay inside the release root.");
  }

  return resolved;
}

function assertAbsoluteConfigDir(configDir: string): string {
  if (!isAbsolute(configDir)) {
    throw new Error(
      "configDir must be an absolute path; relative paths resolve against process.cwd() and break plugin isolation."
    );
  }

  return configDir;
}

export function derivePluginToolName(
  pluginId: string,
  actionKey: string
): string | null {
  const pluginPart = sanitizeToolNamePart(pluginId);
  const actionPart = sanitizeToolNamePart(actionKey);

  if (!(pluginPart && actionPart)) {
    return null;
  }

  const name = `plugin_${pluginPart}__${actionPart}`;

  if (name.length > PLUGIN_TOOL_NAME_MAX_LENGTH) {
    return null;
  }

  return name;
}

function parseSkills(
  value: JsonValue | undefined
):
  | { ok: true; skills: PluginSkillContribution[] }
  | { code: PluginManifestValidationCode; ok: false } {
  if (value === undefined) {
    return { ok: true, skills: [] };
  }

  if (!Array.isArray(value)) {
    return fail("missing_field");
  }

  const skills: PluginSkillContribution[] = [];
  const keys = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      return fail("missing_field");
    }

    if ("entrypoint" in item || "tool" in item || "tools" in item) {
      return fail("undeclared_entrypoint");
    }

    if (!(isNonEmptyString(item.key) && CONTRIBUTION_KEY.test(item.key))) {
      return fail("invalid_identity");
    }

    if (!isNonEmptyString(item.directory)) {
      return fail("missing_field");
    }

    if (!isRelativePluginPath(item.directory)) {
      return fail("invalid_path");
    }

    if (keys.has(item.key)) {
      return fail("duplicate_key");
    }

    keys.add(item.key);
    skills.push({ directory: item.directory, key: item.key });
  }

  return { ok: true, skills };
}

function parseWorkers(
  value: JsonValue | undefined
):
  | { ok: true; workers: PluginWorkerContribution[] }
  | { ok: false; code: PluginManifestValidationCode } {
  if (value === undefined) {
    return { ok: true, workers: [] };
  }

  if (!Array.isArray(value) || value.length > 8) {
    return fail("missing_field");
  }

  const workers: PluginWorkerContribution[] = [];
  const keys = new Set<string>();

  for (const item of value) {
    if (
      !(
        isRecord(item) &&
        isNonEmptyString(item.key) &&
        CONTRIBUTION_KEY.test(item.key) &&
        isNonEmptyString(item.name)
      )
    ) {
      return fail("invalid_identity");
    }

    if (
      !(
        isNonEmptyString(item.entry) &&
        isRelativePluginPath(item.entry) &&
        /\.m?js$/.test(item.entry)
      )
    ) {
      return fail("invalid_path");
    }

    if (
      item.useHostLlm !== undefined &&
      !z.boolean().safeParse(item.useHostLlm).success
    ) {
      return fail("missing_field");
    }

    if (keys.has(item.key)) {
      return fail("duplicate_key");
    }

    keys.add(item.key);

    const worker: PluginWorkerContribution = {
      entry: item.entry,
      key: item.key,
      name: item.name,
    };

    const useHostLlm = z.boolean().safeParse(item.useHostLlm);

    if (useHostLlm.success) {
      worker.useHostLlm = useHostLlm.data;
    }

    workers.push(worker);
  }

  return { ok: true, workers };
}

function parseActions(
  value: JsonValue | undefined
):
  | { actions: PluginActionContribution[]; ok: true }
  | { code: PluginManifestValidationCode; ok: false } {
  if (value === undefined) {
    return { actions: [], ok: true };
  }

  if (!Array.isArray(value)) {
    return fail("missing_field");
  }

  const actions: PluginActionContribution[] = [];
  const keys = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      return fail("missing_field");
    }

    if (!(isNonEmptyString(item.key) && CONTRIBUTION_KEY.test(item.key))) {
      return fail("invalid_identity");
    }

    if (
      !(isNonEmptyString(item.description) && isNonEmptyString(item.entry)) ||
      item.access === undefined ||
      item.effect === undefined ||
      item.inputSchema === undefined
    ) {
      return fail("missing_field");
    }

    if (item.access !== "member" && item.access !== "admin") {
      return fail("missing_field");
    }

    if (item.effect !== "read" && item.effect !== "write") {
      return fail("missing_field");
    }

    if (!isRelativePluginPath(item.entry)) {
      return fail("invalid_path");
    }

    if (!validatePluginJsonSchema(item.inputSchema).ok) {
      return fail("unsupported_schema");
    }

    if (
      item.exposeAsTool !== undefined &&
      !z.boolean().safeParse(item.exposeAsTool).success
    ) {
      return fail("missing_field");
    }

    if (keys.has(item.key)) {
      return fail("duplicate_key");
    }

    keys.add(item.key);

    const action: PluginActionContribution = {
      access: item.access,
      description: item.description,
      effect: item.effect,
      entry: item.entry,
      inputSchema: item.inputSchema,
      key: item.key,
    };

    const exposeAsTool = z.boolean().safeParse(item.exposeAsTool);

    if (exposeAsTool.success) {
      action.exposeAsTool = exposeAsTool.data;
    }

    actions.push(action);
  }

  return { actions, ok: true };
}

function parseUi(
  value: JsonValue | undefined
):
  | { ok: true; ui?: PluginUiContribution }
  | { code: PluginManifestValidationCode; ok: false } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isRecord(value)) {
    return fail("missing_field");
  }

  if (
    !(
      isNonEmptyString(value.pageLabel) &&
      isNonEmptyString(value.entryModule) &&
      isNonEmptyString(value.assetsDir)
    )
  ) {
    return fail("missing_field");
  }

  if (
    !(
      isRelativePluginPath(value.entryModule) &&
      isRelativePluginPath(value.assetsDir)
    )
  ) {
    return fail("invalid_path");
  }

  if (!/\.(?:m?js)$/.test(value.entryModule)) {
    return fail("invalid_path");
  }

  return {
    ok: true,
    ui: {
      assetsDir: value.assetsDir,
      entryModule: value.entryModule,
      pageLabel: value.pageLabel,
    },
  };
}

function parseDatabase(
  value: JsonValue | undefined
):
  | { database?: { migrations: PluginMigrationContribution[] }; ok: true }
  | { code: PluginManifestValidationCode; ok: false } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!(isRecord(value) && Array.isArray(value.migrations))) {
    return fail("missing_field");
  }

  const migrations: PluginMigrationContribution[] = [];
  const ids = new Set<string>();

  for (const item of value.migrations) {
    if (
      !(
        isRecord(item) &&
        isNonEmptyString(item.id) &&
        isNonEmptyString(item.path)
      )
    ) {
      return fail("missing_field");
    }

    if (!isRelativePluginPath(item.path)) {
      return fail("invalid_path");
    }

    if (ids.has(item.id)) {
      return fail("duplicate_key");
    }

    ids.add(item.id);
    migrations.push({ id: item.id, path: item.path });
  }

  return { database: { migrations }, ok: true };
}

function fail(code: PluginManifestValidationCode) {
  return { code, ok: false };
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return z.record(z.string(), JsonValueSchema).safeParse(value).success;
}

function isNonEmptyString(value: JsonValue): value is string {
  const parsed = z.string().trim().min(1).safeParse(value);

  return parsed.success;
}

function isOptionalFiniteNumber(value: JsonValue | undefined): boolean {
  return value === undefined || z.number().finite().safeParse(value).success;
}

function schemaTypes(type: PluginJsonSchema["type"]): string[] | null {
  if (type === undefined) {
    return null;
  }

  return Array.isArray(type) ? type : [type];
}

function matchesSchemaType(
  type: PluginJsonSchema["type"],
  value: JsonValue
): boolean {
  const types = schemaTypes(type);

  if (!types) {
    return true;
  }

  return types.some((item) => matchesSingleType(item, value));
}

function matchesSingleType(type: string, value: JsonValue): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return z.boolean().safeParse(value).success;
    case "integer":
      return z.number().int().safeParse(value).success;
    case "null":
      return value === null;
    case "number":
      return z.number().finite().safeParse(value).success;
    case "object":
      return isRecord(value);
    case "string":
      return z.string().safeParse(value).success;
    default:
      return false;
  }
}

function matchesObjectType(type: PluginJsonSchema["type"]): boolean {
  const types = schemaTypes(type);

  return types === null || types.includes("object");
}

function isRelativePluginPath(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\") || value.includes(":")) {
    return false;
  }

  const parts = value.split("/");

  return (
    parts.length > 0 &&
    parts.every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function sanitizeToolNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
