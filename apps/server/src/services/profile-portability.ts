import { readdir, readFile, rm } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, sep } from "node:path";
import {
  discoverSkillDirectory,
  getProfileAvatarPath,
  getProfileSkillsDir,
  getProfileSoulDir,
  hasProfileAvatar,
  initSoulDirectory,
  isGlobalSkillSourcePath,
  NAKAMA_API_VERSION,
  NakamaApiError,
  type ProfilePackManifest,
  type ProfilePackMeta,
  type ProfilePackPreviewResponse,
  type ProfilePackSkippedItem,
  parseSkillMarkdown,
  pathExists,
  readProfileAvatar,
  SKILL_ARCHIVE_DIR_NAME,
  saveProfileAvatar,
  writePrivateBytesFile,
} from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredProfileComposioToolkitRecord,
  StoredProfileRecord,
  StoredSkillRecord,
} from "@nakama/db";
import { unzipSync, zipSync } from "fflate";

export const PROFILE_PACK_KIND = "nakama-profile-export" as const;
export const PROFILE_PACK_MANIFEST_FILENAME = "nakama-profile-export.json";
export const PROFILE_PACK_FORMAT_VERSION = 1;

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

export interface CreateProfilePackOptions {
  now?: Date;
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
    filename: `nakama-profile-export-${slugifyForFilename(profile.name)}-${createdAt.replace(/[:.]/g, "-")}.zip`,
    manifest,
  };
}

export async function previewProfilePackImport(
  db: DatabaseAdapter,
  orgId: string,
  archive: Buffer | Uint8Array | ArrayBuffer
): Promise<ProfilePackPreviewResponse> {
  const entries = readProfilePackZip(archive);
  const manifest = readProfilePackManifest(entries);

  const skippedAssignments: ProfilePackSkippedItem[] = [];
  const toolNames = await filterResolvable(
    manifest.meta.toolNames,
    async (name) => Boolean(await db.getToolByName(name)),
    "tool",
    skippedAssignments
  );
  const mcpServerNames = await filterResolvable(
    manifest.meta.mcpServerNames,
    async (name) => Boolean(await db.getMcpServerByName(name)),
    "MCP server",
    skippedAssignments
  );
  const composioToolkitSlugs = await filterResolvable(
    manifest.meta.composioToolkitSlugs,
    async (slug) => Boolean(await db.getComposioToolkitBySlug(orgId, slug)),
    "Composio toolkit",
    skippedAssignments
  );
  const bundledSkillNames = await filterResolvable(
    manifest.meta.bundledSkillNames,
    async (name) => Boolean(await db.getSkillByName(name, orgId)),
    "bundled skill",
    skippedAssignments
  );

  const packedSkills = readSkillNamesFromZip(entries);
  const packedSkillNames: string[] = [];

  for (const skill of packedSkills) {
    const existing = await db.getSkillByName(skill.name, orgId);

    if (existing) {
      skippedAssignments.push({
        path: `skills/${skill.folder}`,
        reason: `Skill "${skill.name}" already exists at a different location and will be skipped.`,
      });
      continue;
    }

    packedSkillNames.push(skill.name);
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
    resolvedAssignments: {
      composioToolkitSlugs,
      mcpServerNames,
      skillNames: [...bundledSkillNames, ...packedSkillNames].sort(),
      toolNames,
    },
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

  try {
    const skippedAssignments: ProfilePackSkippedItem[] = [];
    const soulDir = getProfileSoulDir(orgId, profileId);
    await initSoulDirectory(soulDir);
    await writePackedWorkspaceFiles(soulDir, entries, skippedAssignments);
    await recreatePackedSkills(
      db,
      orgId,
      profileId,
      soulDir,
      skippedAssignments
    );
    await assignByNameOrSkip(
      manifest.meta.toolNames,
      async (toolName) => db.getToolByName(toolName),
      async (tool) => db.assignToolToProfile(profileId, tool.id),
      "tool",
      skippedAssignments
    );
    await assignByNameOrSkip(
      manifest.meta.mcpServerNames,
      async (serverName) => db.getMcpServerByName(serverName),
      async (server) => db.assignMcpServerToProfile(profileId, server.id),
      "MCP server",
      skippedAssignments
    );
    await assignByNameOrSkip(
      manifest.meta.bundledSkillNames,
      async (skillName) => db.getSkillByName(skillName, orgId),
      async (skill) => db.assignSkillToProfile(profileId, skill.id),
      "bundled skill",
      skippedAssignments
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
    await rollbackFailedImport(db, orgId, profileId);
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

async function writePackedWorkspaceFiles(
  soulDir: string,
  entries: ProfilePackZipEntry[],
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  for (const entry of entries) {
    if (entry.name === PROFILE_PACK_MANIFEST_FILENAME) {
      continue;
    }

    if (isAvatarEntry(entry.name)) {
      await writePackedAvatar(soulDir, entry);
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
  soulDir: string,
  entry: ProfilePackZipEntry
): Promise<void> {
  const extension = entry.name
    .slice(entry.name.lastIndexOf(".") + 1)
    .toLowerCase();
  const mediaType = AVATAR_EXTENSION_MEDIA_TYPES[extension];

  if (!mediaType) {
    return;
  }

  const [orgId, profileId] = splitProfileSoulDir(soulDir);
  await saveProfileAvatar(orgId, profileId, {
    data: entry.data.toString("base64"),
    mediaType,
  });
}

/** `getProfileSoulDir` joins `.../orgs/{orgId}/profiles/{profileId}`. */
function splitProfileSoulDir(soulDir: string): [string, string] {
  const segments = soulDir.split(sep);
  const profileId = segments.at(-1) ?? "";
  const orgId = segments.at(-3) ?? "";
  return [orgId, profileId];
}

async function recreatePackedSkills(
  db: DatabaseAdapter,
  orgId: string,
  profileId: string,
  soulDir: string,
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  const skillsDir = getProfileSkillsDir(orgId, profileId);

  if (!(await pathExists(skillsDir))) {
    return;
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
  }
}

async function assignByNameOrSkip<T extends { id: string }>(
  names: string[],
  lookup: (name: string) => Promise<T | null>,
  assign: (record: T) => Promise<void>,
  label: string,
  skipped: ProfilePackSkippedItem[]
): Promise<void> {
  for (const name of names) {
    const record = await lookup(name);

    if (record) {
      await assign(record);
    } else {
      skipped.push({
        path: `${label}:${name}`,
        reason: `${capitalize(label)} "${name}" was not found in the destination and was skipped.`,
      });
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

async function filterResolvable(
  names: string[],
  exists: (name: string) => Promise<boolean>,
  label: string,
  skipped: ProfilePackSkippedItem[]
): Promise<string[]> {
  const resolved: string[] = [];

  for (const name of names) {
    if (await exists(name)) {
      resolved.push(name);
    } else {
      skipped.push({
        path: `${label}:${name}`,
        reason: `${capitalize(label)} "${name}" was not found in the destination and will be skipped.`,
      });
    }
  }

  return resolved;
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
  profileId: string
): Promise<void> {
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
  const base = slugifyForFilename(name) || "profile";

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

function slugifyForFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
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

function capitalize(value: string): string {
  return value.length > 0
    ? `${value[0]?.toUpperCase()}${value.slice(1)}`
    : value;
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
