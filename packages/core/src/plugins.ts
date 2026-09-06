import { isAbsolute, join, resolve, sep } from "node:path";
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
const ALLOWED_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);
const ALLOWED_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "properties",
  "required",
  "type",
]);

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
  entryHtml: string;
  pageLabel: string;
}

export interface PluginMigrationContribution {
  id: string;
  path: string;
}

export interface PluginHooksContribution {
  activate?: string;
  deactivate?: string;
}

export interface PluginManifest {
  actions: PluginActionContribution[];
  apiVersion: typeof PLUGIN_MANIFEST_API_VERSION;
  author: string;
  database?: { migrations: PluginMigrationContribution[] };
  description: string;
  hooks?: PluginHooksContribution;
  id: string;
  license: string;
  minNakamaVersion: string;
  name: string;
  skills: PluginSkillContribution[];
  ui?: PluginUiContribution;
  version: string;
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

export function validatePluginManifest(value: unknown): PluginValidationResult {
  if (!isRecord(value)) {
    return fail("invalid_identity");
  }

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

  const hooksResult = parseHooks(value.hooks);
  if (!hooksResult.ok) {
    return hooksResult;
  }

  return {
    manifest: {
      actions: actionsResult.actions,
      apiVersion: PLUGIN_MANIFEST_API_VERSION,
      author: value.author,
      ...(databaseResult.database ? { database: databaseResult.database } : {}),
      description: value.description,
      ...(hooksResult.hooks ? { hooks: hooksResult.hooks } : {}),
      id: value.id,
      license: value.license,
      minNakamaVersion: value.minNakamaVersion,
      name: value.name,
      skills: skillsResult.skills,
      ...(uiResult.ui ? { ui: uiResult.ui } : {}),
      version: value.version,
    },
    ok: true,
  };
}

export function validatePluginJsonSchema(
  value: unknown
): PluginSchemaValidationResult {
  if (!isRecord(value)) {
    return { code: "unsupported_schema", ok: false };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) {
      return { code: "unsupported_schema", ok: false };
    }
  }

  if (value.type !== undefined) {
    const types = Array.isArray(value.type) ? value.type : [value.type];
    if (
      types.length === 0 ||
      types.some(
        (type) => typeof type !== "string" || !ALLOWED_SCHEMA_TYPES.has(type)
      )
    ) {
      return { code: "unsupported_schema", ok: false };
    }
  }

  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0) {
      return { code: "unsupported_schema", ok: false };
    }
    if (
      value.enum.some(
        (item) =>
          typeof item !== "string" &&
          typeof item !== "number" &&
          typeof item !== "boolean" &&
          item !== null
      )
    ) {
      return { code: "unsupported_schema", ok: false };
    }
  }

  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      value.required.some((item) => typeof item !== "string"))
  ) {
    return { code: "unsupported_schema", ok: false };
  }

  if (
    !(
      isOptionalFiniteNumber(value.minLength) &&
      isOptionalFiniteNumber(value.maxLength) &&
      isOptionalFiniteNumber(value.minimum) &&
      isOptionalFiniteNumber(value.maximum) &&
      isOptionalFiniteNumber(value.exclusiveMinimum) &&
      isOptionalFiniteNumber(value.exclusiveMaximum) &&
      isOptionalFiniteNumber(value.minItems) &&
      isOptionalFiniteNumber(value.maxItems)
    )
  ) {
    return { code: "unsupported_schema", ok: false };
  }

  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) {
      return { code: "unsupported_schema", ok: false };
    }
    for (const property of Object.values(value.properties)) {
      if (!validatePluginJsonSchema(property).ok) {
        return { code: "unsupported_schema", ok: false };
      }
    }
  }

  if (value.items !== undefined && !validatePluginJsonSchema(value.items).ok) {
    return { code: "unsupported_schema", ok: false };
  }

  if (value.additionalProperties !== undefined) {
    if (typeof value.additionalProperties === "boolean") {
      return { ok: true };
    }
    if (!validatePluginJsonSchema(value.additionalProperties).ok) {
      return { code: "unsupported_schema", ok: false };
    }
  }

  return { ok: true };
}

export function validatePluginJsonInstance(
  schema: unknown,
  value: unknown
): PluginInstanceValidationResult {
  if (!(validatePluginJsonSchema(schema).ok && isRecord(schema))) {
    return { code: "invalid_input", ok: false };
  }

  if (!matchesSchemaType(schema.type, value)) {
    return { code: "invalid_input", ok: false };
  }

  if (schema.enum !== undefined) {
    const allowed = schema.enum as unknown[];
    if (!allowed.some((item) => Object.is(item, value))) {
      return { code: "invalid_input", ok: false };
    }
  }

  if (
    typeof value === "string" &&
    ((typeof schema.minLength === "number" &&
      value.length < schema.minLength) ||
      (typeof schema.maxLength === "number" && value.length > schema.maxLength))
  ) {
    return { code: "invalid_input", ok: false };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return { code: "invalid_input", ok: false };
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return { code: "invalid_input", ok: false };
    }
    if (
      typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum
    ) {
      return { code: "invalid_input", ok: false };
    }
    if (
      typeof schema.exclusiveMaximum === "number" &&
      value >= schema.exclusiveMaximum
    ) {
      return { code: "invalid_input", ok: false };
    }
  }

  if (Array.isArray(value)) {
    if (
      (typeof schema.minItems === "number" && value.length < schema.minItems) ||
      (typeof schema.maxItems === "number" && value.length > schema.maxItems)
    ) {
      return { code: "invalid_input", ok: false };
    }
    if (schema.items !== undefined) {
      for (const item of value) {
        if (!validatePluginJsonInstance(schema.items, item).ok) {
          return { code: "invalid_input", ok: false };
        }
      }
    }
  }

  if (isRecord(value) && matchesObjectType(schema.type)) {
    if (schema.required !== undefined) {
      for (const key of schema.required as string[]) {
        if (!Object.hasOwn(value, key)) {
          return { code: "invalid_input", ok: false };
        }
      }
    }

    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) {
        continue;
      }
      if (!validatePluginJsonInstance(propertySchema, value[key]).ok) {
        return { code: "invalid_input", ok: false };
      }
    }

    const extraKeys = Object.keys(value).filter((key) => !(key in properties));
    if (schema.additionalProperties === false && extraKeys.length > 0) {
      return { code: "invalid_input", ok: false };
    }
    if (isRecord(schema.additionalProperties)) {
      for (const key of extraKeys) {
        if (
          !validatePluginJsonInstance(schema.additionalProperties, value[key])
            .ok
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
  value: unknown
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

function parseActions(
  value: unknown
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
      typeof item.exposeAsTool !== "boolean"
    ) {
      return fail("missing_field");
    }
    if (keys.has(item.key)) {
      return fail("duplicate_key");
    }
    keys.add(item.key);
    actions.push({
      access: item.access,
      description: item.description,
      effect: item.effect,
      entry: item.entry,
      ...(item.exposeAsTool === undefined
        ? {}
        : { exposeAsTool: item.exposeAsTool }),
      inputSchema: item.inputSchema,
      key: item.key,
    });
  }

  return { actions, ok: true };
}

function parseUi(
  value: unknown
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
      isNonEmptyString(value.entryHtml) &&
      isNonEmptyString(value.assetsDir)
    )
  ) {
    return fail("missing_field");
  }
  if (
    !(
      isRelativePluginPath(value.entryHtml) &&
      isRelativePluginPath(value.assetsDir)
    )
  ) {
    return fail("invalid_path");
  }
  return {
    ok: true,
    ui: {
      assetsDir: value.assetsDir,
      entryHtml: value.entryHtml,
      pageLabel: value.pageLabel,
    },
  };
}

function parseDatabase(
  value: unknown
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

function parseHooks(
  value: unknown
):
  | { hooks?: PluginHooksContribution; ok: true }
  | { code: PluginManifestValidationCode; ok: false } {
  if (value === undefined) {
    return { ok: true };
  }
  if (!isRecord(value)) {
    return fail("missing_field");
  }

  const hooks: PluginHooksContribution = {};
  if (value.activate !== undefined) {
    if (
      !(
        isNonEmptyString(value.activate) && isRelativePluginPath(value.activate)
      )
    ) {
      return fail("invalid_path");
    }
    hooks.activate = value.activate;
  }
  if (value.deactivate !== undefined) {
    if (
      !(
        isNonEmptyString(value.deactivate) &&
        isRelativePluginPath(value.deactivate)
      )
    ) {
      return fail("invalid_path");
    }
    hooks.deactivate = value.deactivate;
  }

  return { hooks, ok: true };
}

function fail(code: PluginManifestValidationCode): {
  code: PluginManifestValidationCode;
  ok: false;
} {
  return { code, ok: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function schemaTypes(type: unknown): string[] | null {
  if (type === undefined) {
    return null;
  }
  return Array.isArray(type)
    ? type.filter((item) => typeof item === "string")
    : [String(type)];
}

function matchesSchemaType(type: unknown, value: unknown): boolean {
  const types = schemaTypes(type);
  if (!types) {
    return true;
  }
  return types.some((item) => matchesSingleType(item, value));
}

function matchesSingleType(type: string, value: unknown): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isRecord(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function matchesObjectType(type: unknown): boolean {
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
