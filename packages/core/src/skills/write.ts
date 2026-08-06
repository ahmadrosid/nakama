import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../fs";
import { getUserConfigDir } from "../user-config";
import { BUNDLED_SKILL_NAMES } from "./bundled-names";
import { isGlobalSkillSourcePath } from "./dedupe";
import { parseSkillMarkdown } from "./parse";
import {
  getGlobalSkillsDir,
  getProfileSkillsDir,
  SKILL_FILE_NAME,
  SKILL_TOOL_FILES,
} from "./paths";

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);
const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * Resolve a path with realpath when possible; if the leaf does not exist yet,
 * realpath the deepest existing parent and rejoin the remainder (same pattern as
 * packages/core/src/tools/paths.ts).
 */
function resolveWithRealpath(targetPath: string): string {
  const absolute = path.resolve(targetPath);
  try {
    return realpathSync(absolute);
  } catch {
    let dir = path.dirname(absolute);
    const root = path.parse(dir).root;

    while (true) {
      try {
        const resolvedDir = realpathSync(dir);
        const relativeDir = path.relative(dir, path.dirname(absolute));
        return path.resolve(resolvedDir, relativeDir, path.basename(absolute));
      } catch {
        if (dir === root) {
          return absolute;
        }
        dir = path.dirname(dir);
      }
    }
  }
}

function isResolvedWithinRoot(resolvedRoot: string, resolvedTarget: string): boolean {
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

export interface CreateSkillFileOptions {
  name: string;
  description: string;
  body?: string;
  disableModelInvocation?: boolean;
  orgId?: string;
  profileId?: string;
}

export function composeSkillMarkdown(options: {
  name: string;
  description: string;
  body?: string;
  disableModelInvocation?: boolean;
}): string {
  const lines = [
    "---",
    `name: ${options.name}`,
    `description: ${options.description}`,
  ];

  if (options.disableModelInvocation) {
    lines.push("disable-model-invocation: true");
  }

  lines.push("---", "", options.body?.trim() ?? "");

  return `${lines.join("\n").trimEnd()}\n`;
}

export function assertValidSkillName(name: string): string {
  const normalized = name.trim().toLowerCase();

  if (!SKILL_NAME_PATTERN.test(normalized)) {
    throw new Error(
      "Skill name must be lowercase letters, numbers, or hyphens (max 64 chars).",
    );
  }

  return normalized;
}

export function assertNotBundledSkillName(name: string): void {
  if (bundledSkillNames.has(name)) {
    throw new Error(`Bundled system skill "${name}" cannot be modified by agents.`);
  }
}

export function parseRawProfileSkillContent(
  content: string,
  orgId: string,
  profileId: string,
): { name: string; description: string } {
  const probePath = path.join(
    getProfileSkillsDir(orgId, profileId),
    "_probe",
    SKILL_FILE_NAME,
  );
  const parsed = parseSkillMarkdown(content, probePath);
  const name = assertValidSkillName(parsed.frontmatter.name);
  assertNotBundledSkillName(name);

  if (name !== parsed.frontmatter.name) {
    throw new Error("Skill frontmatter name must be lowercase kebab-case.");
  }

  return {
    name,
    description: parsed.frontmatter.description,
  };
}

export function isPathWithinProfileSkillsDir(
  orgId: string,
  profileId: string,
  targetPath: string,
): boolean {
  const skillsRoot = resolveWithRealpath(getProfileSkillsDir(orgId, profileId));
  const resolved = resolveWithRealpath(targetPath);
  return isResolvedWithinRoot(skillsRoot, resolved);
}

export function resolveProfileSkillDirectory(
  orgId: string,
  profileId: string,
  name: string,
): string {
  const skillName = assertValidSkillName(name);
  assertNotBundledSkillName(skillName);

  const skillsRoot = resolveWithRealpath(getProfileSkillsDir(orgId, profileId));
  const directory = resolveWithRealpath(path.join(skillsRoot, skillName));

  if (!isResolvedWithinRoot(skillsRoot, directory)) {
    throw new Error("Skill directory escapes the profile skills path.");
  }

  return directory;
}

export function assertPathWithinProfileSkillsDir(
  orgId: string,
  profileId: string,
  targetPath: string,
): string {
  const resolved = resolveWithRealpath(targetPath);

  if (!isPathWithinProfileSkillsDir(orgId, profileId, resolved)) {
    throw new Error("Path is outside the profile skills directory.");
  }

  if (isGlobalSkillSourcePath(resolved)) {
    throw new Error("Global skills cannot be modified by agents.");
  }

  return resolved;
}

export function assertSupportingFileAllowed(filePath: string): void {
  const lower = path.basename(filePath).toLowerCase();

  if (lower === SKILL_FILE_NAME.toLowerCase()) {
    throw new Error(
      `Use patch/edit for ${SKILL_FILE_NAME}; write_file/remove_file are for supporting files only.`,
    );
  }

  if ((SKILL_TOOL_FILES as readonly string[]).some((name) => name.toLowerCase() === lower)) {
    throw new Error(
      `Skill-local tools (${SKILL_TOOL_FILES.join(", ")}) cannot be written by agents.`,
    );
  }
}

async function assertSupportingPathIsNotSymlink(absolutePath: string): Promise<void> {
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error("Supporting file path must not be a symbolic link.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

/**
 * Resolve a supporting file under `skills/<name>/` with path-escape and
 * basename guards. Does not require the file to exist yet.
 */
export function resolveProfileSkillSupportingFilePath(
  orgId: string,
  profileId: string,
  name: string,
  relativePath: string,
): string {
  const directory = resolveProfileSkillDirectory(orgId, profileId, name);
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error("path is required.");
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error("path must be relative to the skill directory.");
  }

  const segments = trimmed.split(/[/\\]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error("path is required.");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("path cannot contain '.' or '..' segments.");
  }

  const target = path.join(directory, ...segments);
  const resolved = assertPathWithinProfileSkillsDir(orgId, profileId, target);
  const skillRoot = resolveWithRealpath(directory);
  const resolvedTarget = resolveWithRealpath(resolved);

  if (!isResolvedWithinRoot(skillRoot, resolvedTarget)) {
    throw new Error("Path escapes the skill directory.");
  }

  assertSupportingFileAllowed(resolved);
  return resolved;
}

export async function writeProfileSkillSupportingFile(options: {
  orgId: string;
  profileId: string;
  name: string;
  relativePath: string;
  content: string;
}): Promise<{ absolutePath: string; relativePath: string }> {
  const absolutePath = resolveProfileSkillSupportingFilePath(
    options.orgId,
    options.profileId,
    options.name,
    options.relativePath,
  );

  await assertSupportingPathIsNotSymlink(absolutePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await assertSupportingPathIsNotSymlink(absolutePath);
  await writeFile(absolutePath, options.content, "utf8");

  const skillRoot = resolveProfileSkillDirectory(
    options.orgId,
    options.profileId,
    options.name,
  );
  const relativePath = path.relative(skillRoot, absolutePath).split(path.sep).join("/");

  return { absolutePath, relativePath };
}

export async function removeProfileSkillSupportingFile(options: {
  orgId: string;
  profileId: string;
  name: string;
  relativePath: string;
}): Promise<{ absolutePath: string; relativePath: string }> {
  const absolutePath = resolveProfileSkillSupportingFilePath(
    options.orgId,
    options.profileId,
    options.name,
    options.relativePath,
  );

  await assertSupportingPathIsNotSymlink(absolutePath);

  if (!(await pathExists(absolutePath))) {
    throw new Error(`Supporting file "${options.relativePath}" not found.`);
  }

  await unlink(absolutePath);

  const skillRoot = resolveProfileSkillDirectory(
    options.orgId,
    options.profileId,
    options.name,
  );
  const relativePath = path.relative(skillRoot, absolutePath).split(path.sep).join("/");

  return { absolutePath, relativePath };
}

export async function createSkillFile(options: CreateSkillFileOptions): Promise<string> {
  const name = options.name.trim().toLowerCase();
  const description = options.description.trim();
  const skillsRoot =
    options.orgId && options.profileId
      ? getProfileSkillsDir(options.orgId, options.profileId)
      : getGlobalSkillsDir();
  const directory = path.join(skillsRoot, name);
  const skillFilePath = path.join(directory, SKILL_FILE_NAME);

  if (await pathExists(skillFilePath)) {
    throw new Error(`Skill "${name}" already exists.`);
  }

  const content = composeSkillMarkdown({
    name,
    description,
    body: options.body,
    disableModelInvocation: options.disableModelInvocation,
  });

  parseSkillMarkdown(content, skillFilePath);

  await mkdir(directory, { recursive: true });
  await writeFile(skillFilePath, content, "utf8");

  return directory;
}

export async function writeRawProfileSkillMarkdown(options: {
  orgId: string;
  profileId: string;
  content: string;
  allowExisting?: boolean;
}): Promise<{
  directory: string;
  name: string;
  description: string;
  created: boolean;
}> {
  const { name, description } = parseRawProfileSkillContent(
    options.content,
    options.orgId,
    options.profileId,
  );

  const directory = resolveProfileSkillDirectory(options.orgId, options.profileId, name);
  const skillFilePath = path.join(directory, SKILL_FILE_NAME);
  const exists = await pathExists(skillFilePath);

  if (exists && !options.allowExisting) {
    throw new Error(`Skill "${name}" already exists.`);
  }

  parseSkillMarkdown(options.content, skillFilePath);

  const nextContent = options.content.endsWith("\n")
    ? options.content
    : `${options.content}\n`;

  if (!exists) {
    await mkdir(directory, { recursive: true });
    await writeFile(skillFilePath, nextContent, "utf8");
    return {
      directory,
      name,
      description,
      created: true,
    };
  }

  const existing = await readFile(skillFilePath, "utf8");
  parseSkillMarkdown(existing, skillFilePath);

  if (existing !== nextContent) {
    await writeFile(skillFilePath, nextContent, "utf8");
  }

  const finalParsed = parseSkillMarkdown(nextContent, skillFilePath);
  return {
    directory,
    name: finalParsed.frontmatter.name,
    description: finalParsed.frontmatter.description,
    created: false,
  };
}

export async function patchSkillFile(options: {
  orgId: string;
  profileId: string;
  name: string;
  oldString: string;
  newString: string;
}): Promise<{
  directory: string;
  name: string;
  description: string;
}> {
  if (!options.oldString) {
    throw new Error("old_string is required for patch.");
  }

  const directory = resolveProfileSkillDirectory(
    options.orgId,
    options.profileId,
    options.name,
  );
  const skillFilePath = path.join(directory, SKILL_FILE_NAME);

  if (!(await pathExists(skillFilePath))) {
    throw new Error(`Skill "${options.name}" not found.`);
  }

  assertPathWithinProfileSkillsDir(options.orgId, options.profileId, skillFilePath);

  const existing = await readFile(skillFilePath, "utf8");
  const occurrences = existing.split(options.oldString).length - 1;

  if (occurrences === 0) {
    throw new Error("old_string not found in SKILL.md.");
  }

  if (occurrences > 1) {
    throw new Error("old_string matched multiple times in SKILL.md; make the match unique.");
  }

  const next = existing.replace(options.oldString, options.newString);
  const parsed = parseSkillMarkdown(next, skillFilePath);
  const expectedName = assertValidSkillName(options.name);

  if (parsed.frontmatter.name !== expectedName) {
    throw new Error("patch cannot rename a skill via frontmatter; create a new skill instead.");
  }

  assertNotBundledSkillName(parsed.frontmatter.name);
  await writeFile(skillFilePath, next.endsWith("\n") ? next : `${next}\n`, "utf8");

  return {
    directory,
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description,
  };
}

function isManagedSkillDirectory(directory: string): boolean {
  const configDir = resolveWithRealpath(getUserConfigDir());
  const resolved = resolveWithRealpath(directory);

  if (!isResolvedWithinRoot(configDir, resolved)) {
    return false;
  }

  const relative = path.relative(configDir, resolved);
  const parts = relative.split(path.sep);

  if (parts[0] === "agent" && parts[1] === "skills" && parts.length >= 3) {
    return true;
  }

  return parts[0] === "orgs" && parts[2] === "profiles" && parts[4] === "skills" && parts.length >= 6;
}

export async function deleteSkillDirectory(directory: string): Promise<void> {
  if (!isManagedSkillDirectory(directory)) {
    throw new Error("Skill directory is outside the allowed skills path.");
  }

  await rm(directory, { recursive: true, force: true });
}
