import { readdir, readFile, rm } from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  createId,
  discoverSkillDirectory,
  getCustomToolsDir,
  getProfileAvatarPath,
  getProfileSkillsDir,
  getProfileSoulDir,
  hasProfileAvatar,
  initSoulDirectory,
  isGlobalSkillSourcePath,
  NAKAMA_API_VERSION,
  NakamaApiError,
  type ProfilePackCustomTool,
  type ProfilePackManifest,
  type ProfilePackMeta,
  type ProfilePackPreviewResponse,
  type ProfilePackSkippedItem,
  parseSkillMarkdown,
  pathExists,
  readProfileAvatar,
  SKILL_ARCHIVE_DIR_NAME,
  saveProfileAvatar,
  slugifyProfileName,
  writePrivateBytesFile,
} from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredProfileComposioToolkitRecord,
  StoredProfileRecord,
  StoredSkillRecord,
  StoredToolRecord,
} from "@nakama/db";
import { unzipSync, zipSync } from "fflate";
import { getCustomToolHandler, isCustomToolType } from "./custom-tool-handlers";
import { readHandlerModulePath } from "./custom-tool-shared";

export const PROFILE_PACK_KIND = "nakama-profile-export" as const;
const PROFILE_PACK_MANIFEST_FILENAME = "nakama-profile-export.json";
const PROFILE_PACK_FORMAT_VERSION = 1;
const CUSTOM_TOOLS_ARCHIVE_DIR = "custom-tools";

/** Only these workspace paths ever leave (export) or enter (import) a pack. */
const ROOT_ALLOWED_FILES = new Set([
  "SOUL.md",
  "STYLE.md",
  "INSTRUCTIONS.md",
  "MEMORY.md",
]);
const ALLOWED_ROOT_SUBDIRS = new Set(["examples", "knowledge-base", "skills"]);
const AVATAR_BASENAME_PATTERN = /^avatar\.[a-z0-9]+$/i;
const AVATAR_EXTENSION_MEDIA_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const NOT_ALLOWLISTED_REASON =
  "Not part of the profile pack allowlist (secrets and generated data are excluded).";
const PROFILE_ID_ATTEMPTS = 50;

interface ProfilePackFile {
  absolutePath: string;
  relativePath: string;
}

interface ProfilePackZipEntry {
  data: Buffer;
  name: string;
}

interface CreatedCustomTool {
  absolutePath: string;
  id: string;
}

interface ValidPackedCustomTool {
  absolutePath: string;
  definition: ProfilePackCustomTool;
  handlerConfig: Record<string, unknown>;
  sourcePath: string;
}

type ToolAssignmentResolution =
  | { kind: "create"; packed: ValidPackedCustomTool; source: Buffer }
  | { kind: "existing"; tool: StoredToolRecord };

export interface CreateProfilePackOptions {
  includeCustomTools?: boolean;
  now?: Date;
}

export interface PreviewProfilePackImportOptions {
  restoreCustomTools?: boolean;
}

export interface CreateProfilePackResult {
  data: Buffer;
  filename: string;
  manifest: ProfilePackManifest;
}

export interface ImportProfilePackOptions {
  confirm: boolean;
  name?: string;
  now?: Date;
  restoreCustomTools?: boolean;
}

export interface ImportProfilePackResult {
  manifest: ProfilePackManifest;
  profileId: string;
  skippedAssignments: ProfilePackSkippedItem[];
}

export async function createProfilePackExport(
  db: DatabaseAdapter,
  orgId: string,
  profileId: string,
  options: CreateProfilePackOptions = {}
): Promise<CreateProfilePackResult> {
  const profile = await db.getProfileForOrg(profileId, orgId);

  if (!profile) {
    throw new NakamaApiError("Profile not found.", 404);
  }

  if (profile.isSuper) {
    throw new NakamaApiError("Super Bot cannot be exported.", 400);
  }

  const soulDir = getProfileSoulDir(orgId, profileId);
  const { files, skipped } = await inventoryProfileSoulDir(soulDir);
  const meta = await buildProfilePackMeta(db, profileId, profile);
  const createdAt = (options.now ?? new Date()).toISOString();

  const entries: Record<string, Uint8Array> = {};

  for (const file of files) {
    entries[file.relativePath] = await readFile(file.absolutePath);
  }

  if (options.includeCustomTools ?? true) {
    const packedTools = await collectPackedCustomTools(db, profileId);
    meta.customTools = packedTools.tools;
    skipped.push(...packedTools.skipped);
    Object.assign(entries, packedTools.entries);
  }

  if (await hasProfileAvatar(orgId, profileId)) {
    const avatar = await readProfileAvatar(orgId, profileId);

    if (avatar) {
      const avatarRelative = basename(
        getProfileAvatarPath(orgId, profileId, avatar.mediaType)
      );
      entries[avatarRelative] = avatar.bytes;
    }
  }

  const topLevelPaths = Array.from(
    new Set(Object.keys(entries).map((path) => path.split("/")[0] ?? ""))
  )
    .filter(Boolean)
    .sort();

  const manifest: ProfilePackManifest = {
    apiVersion: NAKAMA_API_VERSION,
    createdAt,
    kind: PROFILE_PACK_KIND,
    meta,
    skipped,
    sourceProfileId: profileId,
    topLevelPaths,
    version: PROFILE_PACK_FORMAT_VERSION,
  };

  entries[PROFILE_PACK_MANIFEST_FILENAME] = Buffer.from(
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return {
    data: Buffer.from(zipSync(entries)),
    filename: `nakama-profile-export-${slugifyProfileName(profile.name)}-${createdAt.replace(/[:.]/g, "-")}.zip`,
    manifest,
  };
}

export async function previewProfilePackImport(
  db: DatabaseAdapter,
  orgId: string,
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: PreviewProfilePackImportOptions = {}
): Promise<ProfilePackPreviewResponse> {
  const entries = readProfilePackZip(archive);
  const manifest = readProfilePackManifest(entries);

  const skippedAssignments: ProfilePackSkippedItem[] = [];
  await previewToolAssignments(
    db,
    manifest,
    entries,
    options.restoreCustomTools === true,
    skippedAssignments
  );
  await eachNamedOrSkip(
    manifest.meta.mcpServerNames,
    (name) => db.getMcpServerByName(name),
    skippedAssignments,
    (name) => ({
      path: `MCP server:${name}`,
      reason: `MCP server "${name}" was not found in the destination and will be skipped.`,
    })
  );
  await eachNamedOrSkip(
    manifest.meta.composioToolkitSlugs,
    (slug) => db.getComposioToolkitBySlug(orgId, slug),
    skippedAssignments,
    (slug) => ({
      path: `Composio toolkit:${slug}`,
      reason: `Composio toolkit "${slug}" was not found in the destination and will be skipped.`,
    })
  );
  await eachNamedOrSkip(
    manifest.meta.bundledSkillNames,
    (name) => db.getSkillByName(name, orgId),
    skippedAssignments,
    (name) => ({
      path: `bundled skill:${name}`,
      reason: `Bundled skill "${name}" was not found in the destination and will be skipped.`,
    })
  );

  for (const skill of readSkillNamesFromZip(entries)) {
    if (await db.getSkillByName(skill.name, orgId)) {
      skippedAssignments.push({
        path: `skills/${skill.folder}`,
        reason: `Skill "${skill.name}" already exists at a different location and will be skipped.`,
      });
    }
  }

  const restorableEntries = entries.filter(
    (entry) => entry.name !== PROFILE_PACK_MANIFEST_FILENAME
  );
  const topLevelPaths = Array.from(
    new Set(restorableEntries.map((entry) => entry.name.split("/")[0] ?? ""))
  )
    .filter(Boolean)
    .sort();

  return {
    manifest,
    plannedName: manifest.meta.name,
    skippedAssignments,
    topLevelPaths,
  };
}

export async function importProfilePack(
  db: DatabaseAdapter,
  orgId: string,
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: ImportProfilePackOptions
): Promise<ImportProfilePackResult> {
  if (!options.confirm) {
    throw new Error("Import confirmation is required.");
  }

  const entries = readProfilePackZip(archive);
  const manifest = readProfilePackManifest(entries);
  const name = options.name?.trim() || manifest.meta.name || "Imported profile";
  const profileId = await resolveImportedProfileId(db, name);
  const now = (options.now ?? new Date()).toISOString();

  const profile: StoredProfileRecord = {
    createdAt: now,
    id: profileId,
    isDefault: false,
    isSuper: false,
    model: manifest.meta.model,
    name,
    orgId,
    skillsCuratorConsolidateEnabled:
      manifest.meta.skillsCuratorConsolidateEnabled,
    skillsPostTurnReview: manifest.meta.skillsPostTurnReview,
    skillsWriteApproval: manifest.meta.skillsWriteApproval,
    systemPrompt: manifest.meta.systemPrompt,
    thinkingEffort: manifest.meta.thinkingEffort,
    thinkingEnabled: manifest.meta.thinkingEnabled,
    updatedAt: now,
  };

  await db.upsertProfile(profile);

  let createdSkillIds: string[] = [];
  const createdCustomTools: CreatedCustomTool[] = [];

  try {
    const skippedAssignments: ProfilePackSkippedItem[] = [];
    const soulDir = getProfileSoulDir(orgId, profileId);
    await initSoulDirectory(soulDir);
    await writePackedWorkspaceFiles(
      orgId,
      profileId,
      entries,
      skippedAssignments
    );
    createdSkillIds = await recreatePackedSkills(
      db,
      orgId,
      profileId,
      skippedAssignments
    );
    await restoreToolAssignments(
      db,
      profileId,
      manifest,
      entries,
      options.restoreCustomTools === true,
      skippedAssignments,
      createdCustomTools
    );
    await eachNamedOrSkip(
      manifest.meta.mcpServerNames,
      (serverName) => db.getMcpServerByName(serverName),
      skippedAssignments,
      (name) => ({
        path: `MCP server:${name}`,
        reason: `MCP server "${name}" was not found in the destination and was skipped.`,
      }),
      async (server) => {
        await db.assignMcpServerToProfile(profileId, server.id);
      }
    );
    await eachNamedOrSkip(
      manifest.meta.bundledSkillNames,
      (skillName) => db.getSkillByName(skillName, orgId),
      skippedAssignments,
      (name) => ({
        path: `bundled skill:${name}`,
        reason: `Bundled skill "${name}" was not found in the destination and was skipped.`,
      }),
      async (skill) => {
        await db.assignSkillToProfile(profileId, skill.id);
      }
    );
    await assignComposioToolkitsBySlug(
      db,
      orgId,
      profileId,
      manifest.meta.composioToolkitSlugs,
      skippedAssignments
    );

    return { manifest, profileId, skippedAssignments };
  } catch (error) {
    await rollbackFailedImport(
      db,
      orgId,
      profileId,
      createdSkillIds,
      createdCustomTools
    );
    throw error;
  }
}

async function inventoryProfileSoulDir(soulDir: string): Promise<{
  files: ProfilePackFile[];
  skipped: ProfilePackSkippedItem[];
}> {
  const files: ProfilePackFile[] = [];
  const skipped: ProfilePackSkippedItem[] = [];

  if (!(await pathExists(soulDir))) {
    return { files, skipped };
  }

  const rootEntries = await readdir(soulDir, { withFileTypes: true });

  for (const entry of rootEntries) {
    const relativePath = entry.name;
    const absolutePath = join(soulDir, entry.name);

    if (AVATAR_BASENAME_PATTERN.test(entry.name)) {
      // Handled separately via the avatar helpers, which know the real media type.
      continue;
    }

    if (entry.isFile()) {
      if (ROOT_ALLOWED_FILES.has(entry.name)) {
        files.push({ absolutePath, relativePath });
      } else {
        skipped.push({ path: relativePath, reason: NOT_ALLOWLISTED_REASON });
      }
      continue;
    }

    if (!entry.isDirectory()) {
      skipped.push({ path: relativePath, reason: NOT_ALLOWLISTED_REASON });
      continue;
    }

    if (entry.name === "examples" || entry.name === "knowledge-base") {
      await collectFilesRecursively(absolutePath, relativePath, files);
      continue;
    }

    if (entry.name === "skills") {
      await inventorySkillsDir(absolutePath, relativePath, files, skipped);
      continue;
    }

    skipped.push({ path: relativePath, reason: NOT_ALLOWLISTED_REASON });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, skipped };
}

async function inventorySkillsDir(
  skillsDir: string,
  relativeBase: string,
  files: ProfilePackFile[],
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  const entries = await readdir(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = `${relativeBase}/${entry.name}`;

    if (entry.name === SKILL_ARCHIVE_DIR_NAME) {
      skipped.push({
        path: relativePath,
        reason: "Archived skills are excluded from profile packs.",
      });
      continue;
    }

    if (!entry.isDirectory()) {
      skipped.push({ path: relativePath, reason: NOT_ALLOWLISTED_REASON });
      continue;
    }

    await collectFilesRecursively(
      join(skillsDir, entry.name),
      relativePath,
      files
    );
  }
}

async function collectFilesRecursively(
  dir: string,
  relativeBase: string,
  out: ProfilePackFile[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = `${relativeBase}/${entry.name}`;

    if (entry.isDirectory()) {
      await collectFilesRecursively(absolutePath, relativePath, out);
    } else if (entry.isFile()) {
      out.push({ absolutePath, relativePath });
    }
  }
}

async function buildProfilePackMeta(
  db: DatabaseAdapter,
  profileId: string,
  profile: StoredProfileRecord
): Promise<ProfilePackMeta> {
  const tools = await db.listToolsForProfile(profileId);
  const mcpServers = await db.listMcpServersForProfile(profileId);
  const skills = await db.listSkillsForProfile(profileId);
  const toolkitAssignments = await db.listProfileComposioToolkits(profileId);

  const bundledSkillNames: string[] = [];
  const profileSkillNames: string[] = [];

  for (const skill of skills) {
    if (isGlobalSkillSourcePath(skill.sourcePath)) {
      bundledSkillNames.push(skill.name);
    } else {
      profileSkillNames.push(skill.name);
    }
  }

  const composioToolkitSlugs: string[] = [];

  for (const assignment of toolkitAssignments) {
    const toolkit = await db.getComposioToolkit(assignment.toolkitId);

    if (toolkit) {
      composioToolkitSlugs.push(toolkit.toolkitSlug);
    }
  }

  return {
    bundledSkillNames: bundledSkillNames.sort(),
    composioToolkitSlugs: composioToolkitSlugs.sort(),
    mcpServerNames: mcpServers.map((server) => server.name).sort(),
    model: profile.model,
    name: profile.name,
    profileSkillNames: profileSkillNames.sort(),
    skillsCuratorConsolidateEnabled:
      profile.skillsCuratorConsolidateEnabled ?? null,
    skillsPostTurnReview: profile.skillsPostTurnReview ?? null,
    skillsWriteApproval: profile.skillsWriteApproval ?? null,
    systemPrompt: profile.systemPrompt,
    thinkingEffort: profile.thinkingEffort ?? null,
    thinkingEnabled: profile.thinkingEnabled ?? null,
    toolNames: tools.map((tool) => tool.name).sort(),
  };
}

async function collectPackedCustomTools(
  db: DatabaseAdapter,
  profileId: string
): Promise<{
  entries: Record<string, Uint8Array>;
  skipped: ProfilePackSkippedItem[];
  tools: ProfilePackCustomTool[];
}> {
  const entries: Record<string, Uint8Array> = {};
  const skipped: ProfilePackSkippedItem[] = [];
  const packedTools: ProfilePackCustomTool[] = [];
  const tools = await db.listToolsForProfile(profileId);

  for (const tool of tools) {
    const handler = getCustomToolHandler(tool.handlerType);

    if (!handler) {
      continue;
    }

    const storedModulePath = readHandlerModulePath(tool.handlerConfig);

    if (!storedModulePath) {
      skipped.push(customToolSkip(tool.name, "has no module path"));
      continue;
    }

    let absolutePath: string;

    try {
      absolutePath = handler.resolveModulePath(storedModulePath);
    } catch {
      skipped.push(customToolSkip(tool.name, "has an invalid module path"));
      continue;
    }

    const modulePath = portableCustomToolModulePath(absolutePath);

    if (!(modulePath && modulePath.endsWith(handler.extension))) {
      skipped.push(customToolSkip(tool.name, "has an invalid module path"));
      continue;
    }

    const sourcePath = `${CUSTOM_TOOLS_ARCHIVE_DIR}/${modulePath}`;

    if (entries[sourcePath]) {
      skipped.push(
        customToolSkip(tool.name, `shares the module path "${modulePath}"`)
      );
      continue;
    }

    let source: Buffer;

    try {
      source = await readFile(absolutePath);
    } catch {
      skipped.push(customToolSkip(tool.name, "has no readable source file"));
      continue;
    }

    const handlerConfig = isPlainRecord(tool.handlerConfig)
      ? { ...tool.handlerConfig, modulePath }
      : { modulePath };

    entries[sourcePath] = source;
    packedTools.push({
      description: tool.description,
      handlerConfig,
      handlerType: tool.handlerType as ProfilePackCustomTool["handlerType"],
      name: tool.name,
    });
  }

  return {
    entries,
    skipped,
    tools: packedTools.sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
  };
}

async function previewToolAssignments(
  db: DatabaseAdapter,
  manifest: ProfilePackManifest,
  entries: ProfilePackZipEntry[],
  restoreCustomTools: boolean,
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  for (const name of manifest.meta.toolNames) {
    await resolveToolAssignment(
      db,
      manifest,
      entries,
      name,
      restoreCustomTools,
      skipped
    );
  }
}

async function restoreToolAssignments(
  db: DatabaseAdapter,
  profileId: string,
  manifest: ProfilePackManifest,
  entries: ProfilePackZipEntry[],
  restoreCustomTools: boolean,
  skipped: ProfilePackSkippedItem[],
  createdTools: CreatedCustomTool[]
): Promise<void> {
  for (const name of manifest.meta.toolNames) {
    const resolution = await resolveToolAssignment(
      db,
      manifest,
      entries,
      name,
      restoreCustomTools,
      skipped
    );

    if (!resolution) {
      continue;
    }

    if (resolution.kind === "existing") {
      await db.assignToolToProfile(profileId, resolution.tool.id);
      continue;
    }

    const { packed, source } = resolution;
    const now = new Date().toISOString();
    const record: StoredToolRecord = {
      createdAt: now,
      description: packed.definition.description,
      handlerConfig: packed.handlerConfig,
      handlerType: packed.definition.handlerType,
      id: createId("tool"),
      name,
      updatedAt: now,
    };

    await writePrivateBytesFile(packed.absolutePath, source);

    const handler = getCustomToolHandler(packed.definition.handlerType);
    const modulePath = readHandlerModulePath(packed.handlerConfig);

    if (!(handler && modulePath)) {
      await rm(packed.absolutePath, { force: true });
      skipped.push(customToolSkip(name, "has invalid handler metadata"));
      continue;
    }

    try {
      await handler.validateModule(modulePath);
    } catch (error) {
      await rm(packed.absolutePath, { force: true });
      skipped.push(
        customToolSkip(
          name,
          `failed validation: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
      continue;
    }

    try {
      await db.upsertTool(record);
      await db.assignToolToProfile(profileId, record.id);
      createdTools.push({ absolutePath: packed.absolutePath, id: record.id });
    } catch (error) {
      await db.deleteTool(record.id);
      await rm(packed.absolutePath, { force: true });
      throw error;
    }
  }
}

async function resolveToolAssignment(
  db: DatabaseAdapter,
  manifest: ProfilePackManifest,
  entries: ProfilePackZipEntry[],
  name: string,
  restoreCustomTools: boolean,
  skipped: ProfilePackSkippedItem[]
): Promise<ToolAssignmentResolution | null> {
  const existing = await db.getToolByName(name);
  const packed = findPackedCustomTool(manifest, name);

  if (!packed) {
    if (hasPackedCustomToolNamed(manifest, name)) {
      skipped.push(customToolSkip(name, "has invalid metadata"));
      return null;
    }

    if (existing) {
      return { kind: "existing", tool: existing };
    }

    skipped.push(missingToolSkip(name));
    return null;
  }

  const sourceEntry = entries.find((entry) => entry.name === packed.sourcePath);

  if (!sourceEntry) {
    skipped.push(customToolSkip(name, "is missing its packed source file"));
    return null;
  }

  if (existing) {
    if (await existingToolMatchesPack(existing, packed, sourceEntry.data)) {
      return { kind: "existing", tool: existing };
    }

    skipped.push(
      customToolSkip(name, "conflicts with an existing tool or module")
    );
    return null;
  }

  if (!restoreCustomTools) {
    skipped.push(
      customToolSkip(name, "requires a platform admin to restore its source")
    );
    return null;
  }

  if (await pathExists(packed.absolutePath)) {
    skipped.push(customToolSkip(name, "cannot replace an existing module"));
    return null;
  }

  return { kind: "create", packed, source: sourceEntry.data };
}

async function existingToolMatchesPack(
  existing: StoredToolRecord,
  packed: ValidPackedCustomTool,
  packedSource: Buffer
): Promise<boolean> {
  if (
    existing.handlerType !== packed.definition.handlerType ||
    !isPlainRecord(existing.handlerConfig)
  ) {
    return false;
  }

  const handler = getCustomToolHandler(existing.handlerType);
  const modulePath = readHandlerModulePath(existing.handlerConfig);

  if (!(handler && modulePath)) {
    return false;
  }

  let absolutePath: string;

  try {
    absolutePath = handler.resolveModulePath(modulePath);
  } catch {
    return false;
  }

  const normalizedConfig = {
    ...existing.handlerConfig,
    modulePath: portableCustomToolModulePath(absolutePath),
  };

  if (
    absolutePath !== packed.absolutePath ||
    !isDeepStrictEqual(normalizedConfig, packed.handlerConfig)
  ) {
    return false;
  }

  try {
    return (await readFile(absolutePath)).equals(packedSource);
  } catch {
    return false;
  }
}

function hasPackedCustomToolNamed(
  manifest: ProfilePackManifest,
  name: string
): boolean {
  const definitions: unknown = manifest.meta.customTools;
  return (
    Array.isArray(definitions) &&
    definitions.some((entry) => isPlainRecord(entry) && entry.name === name)
  );
}

function findPackedCustomTool(
  manifest: ProfilePackManifest,
  name: string
): ValidPackedCustomTool | null {
  const definitions: unknown = manifest.meta.customTools;

  if (!Array.isArray(definitions)) {
    return null;
  }

  const value = definitions.find(
    (entry) => isPlainRecord(entry) && entry.name === name
  );

  if (
    !isPlainRecord(value) ||
    typeof value.description !== "string" ||
    typeof value.handlerType !== "string" ||
    !isCustomToolType(value.handlerType) ||
    !isPlainRecord(value.handlerConfig)
  ) {
    return null;
  }

  const modulePath = readHandlerModulePath(value.handlerConfig);
  const handler = getCustomToolHandler(value.handlerType);

  if (!(modulePath && handler && modulePath.endsWith(handler.extension))) {
    return null;
  }

  let absolutePath: string;

  try {
    absolutePath = handler.resolveModulePath(modulePath);
  } catch {
    return null;
  }

  const portableModulePath = portableCustomToolModulePath(absolutePath);
  const sourcePath = `${CUSTOM_TOOLS_ARCHIVE_DIR}/${portableModulePath}`;

  if (!portableModulePath) {
    return null;
  }

  return {
    absolutePath,
    definition: {
      description: value.description,
      handlerConfig: value.handlerConfig,
      handlerType: value.handlerType,
      name,
    },
    handlerConfig: { ...value.handlerConfig, modulePath: portableModulePath },
    sourcePath,
  };
}

function portableCustomToolModulePath(absolutePath: string): string | null {
  const modulePath = toZipPath(relative(getCustomToolsDir(), absolutePath));

  if (
    !modulePath ||
    modulePath === ".." ||
    modulePath.startsWith("../") ||
    isAbsolute(modulePath)
  ) {
    return null;
  }

  return modulePath;
}

function customToolSkip(name: string, detail: string): ProfilePackSkippedItem {
  return {
    path: `custom tool:${name}`,
    reason: `Custom tool "${name}" ${detail}.`,
  };
}

function missingToolSkip(name: string): ProfilePackSkippedItem {
  return {
    path: `tool:${name}`,
    reason: `Tool "${name}" was not found in the destination and will be skipped.`,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writePackedWorkspaceFiles(
  orgId: string,
  profileId: string,
  entries: ProfilePackZipEntry[],
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  const soulDir = getProfileSoulDir(orgId, profileId);

  for (const entry of entries) {
    if (entry.name === PROFILE_PACK_MANIFEST_FILENAME) {
      continue;
    }

    if (entry.name.startsWith(`${CUSTOM_TOOLS_ARCHIVE_DIR}/`)) {
      continue;
    }

    if (isAvatarEntry(entry.name)) {
      await writePackedAvatar(orgId, profileId, entry);
      continue;
    }

    if (!isAllowlistedProfilePackPath(entry.name)) {
      skipped.push({ path: entry.name, reason: NOT_ALLOWLISTED_REASON });
      continue;
    }

    const targetPath = join(soulDir, entry.name);
    await writePrivateBytesFile(targetPath, entry.data);
  }
}

async function writePackedAvatar(
  orgId: string,
  profileId: string,
  entry: ProfilePackZipEntry
): Promise<void> {
  const extension = entry.name
    .slice(entry.name.lastIndexOf(".") + 1)
    .toLowerCase();
  const mediaType = AVATAR_EXTENSION_MEDIA_TYPES[extension];

  if (!mediaType) {
    return;
  }

  await saveProfileAvatar(orgId, profileId, {
    data: entry.data.toString("base64"),
    mediaType,
  });
}

async function recreatePackedSkills(
  db: DatabaseAdapter,
  orgId: string,
  profileId: string,
  skipped: ProfilePackSkippedItem[]
): Promise<string[]> {
  const skillsDir = getProfileSkillsDir(orgId, profileId);
  const createdSkillIds: string[] = [];

  if (!(await pathExists(skillsDir))) {
    return createdSkillIds;
  }

  const folders = (await readdir(skillsDir, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name !== SKILL_ARCHIVE_DIR_NAME
  );

  for (const folder of folders) {
    const sourcePath = join(skillsDir, folder.name);
    const discovered = await discoverSkillDirectory(sourcePath);

    if (!discovered) {
      skipped.push({
        path: `skills/${folder.name}`,
        reason: "Skill directory is missing a valid SKILL.md and was skipped.",
      });
      continue;
    }

    const existing = await db.getSkillByName(discovered.name, orgId);

    if (existing && existing.sourcePath !== sourcePath) {
      skipped.push({
        path: `skills/${folder.name}`,
        reason: `Skill "${discovered.name}" already exists at a different location and was skipped.`,
      });
      continue;
    }

    if (existing) {
      await db.assignSkillToProfile(profileId, existing.id);
      continue;
    }

    const now = new Date().toISOString();
    const record: StoredSkillRecord = {
      createdAt: now,
      createdBy: "human",
      description: discovered.description,
      disableModelInvocation: discovered.disableModelInvocation,
      enabled: true,
      hasTool: discovered.hasTool,
      id: `skill_${crypto.randomUUID()}`,
      name: discovered.name,
      orgId,
      sourcePath,
      updatedAt: now,
    };

    await db.upsertSkill(record);
    await db.assignSkillToProfile(profileId, record.id);
    createdSkillIds.push(record.id);
  }

  return createdSkillIds;
}

async function eachNamedOrSkip<T extends { id: string }>(
  names: string[],
  lookup: (name: string) => Promise<T | null>,
  skipped: ProfilePackSkippedItem[],
  notFound: (name: string) => ProfilePackSkippedItem,
  onHit?: (record: T) => Promise<void>
): Promise<void> {
  for (const name of names) {
    const record = await lookup(name);

    if (!record) {
      skipped.push(notFound(name));
      continue;
    }

    if (onHit) {
      await onHit(record);
    }
  }
}

async function assignComposioToolkitsBySlug(
  db: DatabaseAdapter,
  orgId: string,
  profileId: string,
  toolkitSlugs: string[],
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  const assignments: StoredProfileComposioToolkitRecord[] = [];

  for (const slug of toolkitSlugs) {
    const toolkit = await db.getComposioToolkitBySlug(orgId, slug);

    if (toolkit) {
      assignments.push({
        allowedActions: null,
        profileId,
        toolkitId: toolkit.id,
      });
    } else {
      skipped.push({
        path: `composio:${slug}`,
        reason: `Composio toolkit "${slug}" was not found in the destination org and was skipped.`,
      });
    }
  }

  if (assignments.length > 0) {
    await db.replaceProfileComposioToolkits(profileId, assignments);
  }
}

function readSkillNamesFromZip(
  entries: ProfilePackZipEntry[]
): { folder: string; name: string }[] {
  const results: { folder: string; name: string }[] = [];

  for (const entry of entries) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name);

    if (!match || match[1] === SKILL_ARCHIVE_DIR_NAME) {
      continue;
    }

    try {
      const parsed = parseSkillMarkdown(
        entry.data.toString("utf8"),
        entry.name
      );
      results.push({
        folder: match[1] as string,
        name: parsed.frontmatter.name,
      });
    } catch {
      // Invalid SKILL.md content is reported again (as a skip) when the
      // files are actually written to disk during import.
    }
  }

  return results;
}

async function rollbackFailedImport(
  db: DatabaseAdapter,
  orgId: string,
  profileId: string,
  createdSkillIds: string[],
  createdCustomTools: CreatedCustomTool[]
): Promise<void> {
  for (const tool of createdCustomTools) {
    try {
      await db.deleteTool(tool.id);
      await rm(tool.absolutePath, { force: true });
    } catch {
      // Best-effort cleanup only; the original error is what matters.
    }
  }

  for (const skillId of createdSkillIds) {
    try {
      await db.deleteSkill(skillId);
    } catch {
      // Best-effort cleanup only; the original error is what matters.
    }
  }

  try {
    await db.deleteProfile(profileId);
  } catch {
    // Best-effort cleanup only; the original error is what matters.
  }

  try {
    await rm(getProfileSoulDir(orgId, profileId), {
      force: true,
      recursive: true,
    });
  } catch {
    // Best-effort cleanup only.
  }
}

async function resolveImportedProfileId(
  db: DatabaseAdapter,
  name: string
): Promise<string> {
  const base = slugifyProfileName(name);

  for (let suffix = 1; suffix <= PROFILE_ID_ATTEMPTS; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;

    if (!(await db.getProfile(candidate))) {
      return candidate;
    }
  }

  throw new NakamaApiError(
    `Could not find a free profile id for "${name}".`,
    409
  );
}

function isAvatarEntry(relativePath: string): boolean {
  return (
    !relativePath.includes("/") && AVATAR_BASENAME_PATTERN.test(relativePath)
  );
}

function isAllowlistedProfilePackPath(relativePath: string): boolean {
  if (ROOT_ALLOWED_FILES.has(relativePath)) {
    return true;
  }

  const [first, second] = relativePath.split("/");

  if (!(first && ALLOWED_ROOT_SUBDIRS.has(first))) {
    return false;
  }

  if (first === "skills") {
    return Boolean(second) && second !== SKILL_ARCHIVE_DIR_NAME;
  }

  return Boolean(second);
}

function readProfilePackZip(
  archive: Buffer | Uint8Array | ArrayBuffer
): ProfilePackZipEntry[] {
  try {
    return Object.entries(unzipSync(toBuffer(archive)))
      .filter(([name]) => !name.endsWith("/"))
      .map(([name, data]) => {
        validateProfilePackEntryPath(name);
        return { data: Buffer.from(data), name };
      });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "invalid zip data") {
        throw new Error("Invalid ZIP archive.");
      }
      throw error;
    }
    throw new Error("Invalid ZIP archive.");
  }
}

function readProfilePackManifest(
  entries: ProfilePackZipEntry[]
): ProfilePackManifest {
  const manifestEntry = entries.find(
    (entry) => entry.name === PROFILE_PACK_MANIFEST_FILENAME
  );

  if (!manifestEntry) {
    throw new Error("Archive is missing the Nakama profile pack manifest.");
  }

  let manifest: ProfilePackManifest;

  try {
    manifest = JSON.parse(
      manifestEntry.data.toString("utf8")
    ) as ProfilePackManifest;
  } catch {
    throw new Error("Nakama profile pack manifest is not valid JSON.");
  }

  if (manifest.kind !== PROFILE_PACK_KIND) {
    throw new Error("Archive is not a Nakama profile pack.");
  }

  if (manifest.version !== PROFILE_PACK_FORMAT_VERSION) {
    throw new Error(
      `Unsupported Nakama profile pack version: ${manifest.version}`
    );
  }

  return manifest;
}

function validateProfilePackEntryPath(path: string): void {
  if (!path || path.includes("\0")) {
    throw new Error("Archive entry path is empty or invalid.");
  }

  if (path !== toZipPath(path)) {
    throw new Error(`Archive entry must use POSIX separators: ${path}`);
  }

  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`Archive entry must be relative: ${path}`);
  }

  const normalized = normalize(path).split(sep).join("/");

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Archive entry escapes profile pack root: ${path}`);
  }
}

function toZipPath(path: string): string {
  return path.split(sep).join("/");
}

function toBuffer(value: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
