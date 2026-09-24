import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  CreateSkillRequest,
  InstallSkillRequest,
  ListSkillsResponse,
  PatchSkillRequest,
  SkillFileResponse,
  SkillFilesResponse,
  SkillResponse,
  SkillSummary,
  SkillUsageSummary,
  SyncSkillsResponse,
  ToolDefinition,
} from "@nakama/core";
import {
  assertNotBundledSkillName,
  assertValidSkillName,
  BUNDLED_SKILL_NAMES,
  composeAgentBrowserCapabilityPrompt,
  composeMatchedSkillsPrompt,
  composeSkillMarkdown,
  composeSkillsCatalog,
  createId,
  createSkillFile,
  type DiscoveredSkill,
  dedupeSkillsByName,
  deleteSkillDirectory,
  discoverSkillDirectory,
  discoverSkills,
  extractExplicitSkillName,
  fetchGitHubSkillBundle,
  type GitHubSkillBundle,
  getProfileSoulDir,
  guardFilePath,
  isGlobalSkillSourcePath,
  isPathWithinProfileSkillsDir,
  loadSkillTools,
  matchSkillsForMessage,
  NakamaApiError,
  orgIdFromSkillSourcePath,
  parseRawProfileSkillContent,
  parseSkillMarkdown,
  patchSkillFile,
  pickPreferredSkillSourcePath,
  readUploadedSkillBundle,
  removeProfileSkillSupportingFile,
  resolveProfileSkillDirectory,
  resolveProfileSkillSupportingFilePath,
  SKILL_FILE_NAME,
  writeProfileSkillSupportingFile,
  writeRawProfileSkillMarkdown,
} from "@nakama/core";
import { inferArtifactMimeType } from "@nakama/core/artifact-mime";
import { pathExists } from "@nakama/core/fs";
import type {
  DatabaseAdapter,
  SkillCreatedBy,
  StoredSkillRecord,
  StoredSkillUsageRecord,
} from "@nakama/db";
import type { PluginService } from "./plugin-service";
import {
  type ProfileChangeMeta,
  recordProfileChangeEvent,
  withAssignmentChange,
} from "./profile-change-history";
import { loadPythonSkillTool } from "./python-skill-tool-loader";

export interface SkillUsageRecordingContext {
  seenCatalogSkillIds: Set<string>;
  sessionId: string;
}

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

function isPluginOwnedSkill(record: StoredSkillRecord): boolean {
  return Boolean(record.pluginId && record.pluginKey);
}

function parseSkillsAddCommand(command: string): string {
  const tokens = command
    .match(/"[^"]*"|'[^']*'|\S+/g)
    ?.map((token) => token.replace(/^("|')|("|')$/g, ""));
  if (
    !tokens ||
    tokens.length < 4 ||
    tokens[0] !== "npx" ||
    !/^skills(?:@[\w.-]+)?$/.test(tokens[1] ?? "") ||
    tokens[2] !== "add"
  ) {
    throw new NakamaApiError(
      "Use: npx skills add <github-owner>/<repo> --skill <name>.",
      400
    );
  }

  const source = tokens[3];
  const skillIndex = tokens.indexOf("--skill");
  const skillName = skillIndex >= 0 ? tokens[skillIndex + 1] : undefined;
  if (!(source && skillName) || tokens.length !== skillIndex + 2) {
    throw new NakamaApiError(
      "Include one skill, for example: npx skills add vercel-labs/agent-skills --skill pdf.",
      400
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(
      source.includes("://") ? source : `https://github.com/${source}`
    );
  } catch {
    throw new NakamaApiError(
      "The npx skills add source must be a public GitHub repository.",
      400
    );
  }
  if (
    baseUrl.hostname !== "github.com" ||
    baseUrl.pathname.split("/").filter(Boolean).length !== 2
  ) {
    throw new NakamaApiError(
      "The npx skills add source must be a public GitHub repository.",
      400
    );
  }
  return `${baseUrl.origin}${baseUrl.pathname}/tree/HEAD/${encodeURIComponent(skillName)}`;
}

export class SkillsService {
  private pluginService: PluginService | null = null;
  private readonly profileSkillSyncs = new Map<string, Promise<unknown>>();

  constructor(private readonly db: DatabaseAdapter) {}

  setPluginService(service: PluginService | null): void {
    this.pluginService?.setProfileSkillSync(null);
    this.pluginService = service;
    service?.setProfileSkillSync(async (orgId) => {
      for (const profile of await this.db.listProfiles()) {
        if (profile.orgId === orgId) {
          await this.materializeAssignedPluginSkills(orgId, profile.id);
        }
      }
    });
  }

  async syncDiscoveredSkills(): Promise<SyncSkillsResponse> {
    const discovered = await discoverSkills();
    let created = 0;
    let updated = 0;

    for (const skill of discovered) {
      const result = await this.upsertDiscoveredSkill(skill);
      created += result.created ? 1 : 0;
      updated += result.created ? 0 : 1;
    }

    await this.consolidateDuplicateSkills();

    return {
      created,
      discovered: discovered.length,
      updated,
    };
  }

  async syncProfileSkills(orgId: string, profileId: string): Promise<void> {
    const discovered = await discoverSkills({ orgId, profileId });

    for (const skill of discovered) {
      if (isGlobalSkillSourcePath(skill.directory)) {
        continue;
      }

      await this.upsertDiscoveredSkill(skill);
    }
  }

  async listSkills(orgId?: string): Promise<ListSkillsResponse> {
    await this.syncDiscoveredSkills();

    const profiles = await this.db.listProfiles();

    for (const profile of profiles) {
      if (!profile.orgId || (orgId && profile.orgId !== orgId)) {
        continue;
      }

      await this.syncProfileSkills(profile.orgId, profile.id);
    }

    const skills = await this.db.listSkills();
    return {
      skills: skills
        .filter((skill) => !(orgId && skill.orgId) || skill.orgId === orgId)
        .map(toSkillSummary),
    };
  }

  async createSkill(
    orgId: string,
    request: CreateSkillRequest
  ): Promise<SkillResponse> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("Skill name is required.");
    }

    // Optional chaining because a create with no description used to reach
    // .trim() on undefined and answer 500, which reads as a server fault for
    // what is a missing field.
    if (!request.description?.trim()) {
      throw new Error("Skill description is required.");
    }

    const profileId = request.profileId?.trim() || undefined;
    const directory = await createSkillFile({
      body: request.body,
      description: request.description.trim(),
      disableModelInvocation: request.disableModelInvocation,
      name,
      orgId: profileId ? orgId : undefined,
      profileId,
      scripts: request.scripts,
    });

    const discovered = await discoverSkillDirectory(directory);

    if (!discovered) {
      throw new Error("Skill was created but could not be discovered.");
    }

    await this.upsertDiscoveredSkill(discovered);

    const record = await this.db.getSkillBySourcePath(directory);

    if (!record) {
      throw new Error("Skill was created but could not be synced.");
    }

    return this.getSkill(record.id);
  }

  async patchSkill(
    orgId: string,
    skillId: string,
    request: PatchSkillRequest,
    options?: { profileId?: string }
  ): Promise<SkillResponse> {
    const hasDescription = request.description !== undefined;
    const hasBody = request.body !== undefined;
    const hasDisableModelInvocation =
      request.disableModelInvocation !== undefined;

    if (!(hasDescription || hasBody || hasDisableModelInvocation)) {
      throw new Error("No skill changes provided.");
    }

    const record = await this.requireSkill(skillId);

    if (isPluginOwnedSkill(record)) {
      throw new Error("Plugin-owned skills cannot be edited.");
    }

    if (bundledSkillNames.has(record.name)) {
      throw new Error("Bundled system skills cannot be edited.");
    }

    const skillFilePath = path.join(record.sourcePath, SKILL_FILE_NAME);
    const existing = await readFile(skillFilePath, "utf8");
    const parsed = parseSkillMarkdown(existing, skillFilePath);
    const description =
      request.description === undefined
        ? parsed.frontmatter.description
        : request.description.trim();

    if (!description) {
      throw new Error("Skill description is required.");
    }

    const body = request.body === undefined ? parsed.body : request.body;
    const disableModelInvocation =
      request.disableModelInvocation === undefined
        ? parsed.frontmatter.disableModelInvocation
        : request.disableModelInvocation;

    const content = composeSkillMarkdown({
      body,
      description,
      disableModelInvocation,
      name: parsed.frontmatter.name,
      // Carried from what is on disk. A patch edits prose; it has no opinion
      // about which scripts the skill ships, and dropping the key here leaves
      // the skill installed with none of its scripts loaded as tools.
      scripts: parsed.frontmatter.scripts,
    });

    parseSkillMarkdown(content, skillFilePath);
    await writeFile(skillFilePath, content, "utf8");

    const synced = await this.syncSkillRecordFromDirectory(
      record.sourcePath,
      parsed.frontmatter.name,
      "patched"
    );

    const profileId = options?.profileId?.trim();
    if (profileId) {
      await this.recordPatch(orgId, profileId, synced.id);
    }

    return this.getSkill(synced.id);
  }

  async createAndAssignSkillToProfile(
    orgId: string,
    profileId: string,
    request: Omit<CreateSkillRequest, "profileId">
  ): Promise<SkillResponse> {
    const created = await this.createSkill(orgId, {
      ...request,
      profileId,
    });

    await this.db.assignSkillToProfile(profileId, created.skill.id);

    return created;
  }

  async installSkillFromGitHub(
    orgId: string,
    request: InstallSkillRequest
  ): Promise<SkillResponse> {
    const profileId = request.profileId?.trim() ?? "";
    const url = request.url?.trim() ?? "";
    const command = request.command?.trim() ?? "";

    if (!profileId) {
      throw new NakamaApiError("profileId is required.", 400);
    }

    if (!(url || command || request.zipBase64)) {
      throw new NakamaApiError(
        "A GitHub URL, npx skills add command, or ZIP file is required.",
        400
      );
    }

    const profile = await this.db.getProfileForOrg(profileId, orgId);
    if (!profile) {
      throw new NakamaApiError("Profile not found.", 404);
    }

    const commandUrl = command ? parseSkillsAddCommand(command) : "";
    const bundle = request.zipBase64
      ? (() => {
          const archive = Buffer.from(request.zipBase64!, "base64");
          if (archive.length > 50 * 1024 * 1024) {
            throw new NakamaApiError("Skill ZIP is too large.", 400);
          }
          return readUploadedSkillBundle(archive);
        })()
      : await fetchGitHubSkillBundle(url || commandUrl);
    const { content } = bundle;

    try {
      parseSkillMarkdown(content, url || commandUrl);
    } catch (error) {
      throw new NakamaApiError(
        error instanceof Error
          ? error.message
          : "Skill file is missing or has invalid frontmatter.",
        400
      );
    }

    try {
      const installed = await this.createAndAssignRawSkillToProfile(
        orgId,
        profileId,
        content,
        { createdBy: "human", supportingFiles: bundle.files }
      );
      return { skill: installed.skill };
    } catch (error) {
      if (error instanceof NakamaApiError) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Failed to install skill.";

      if (
        /already exists|already assigned|cannot be attached|bundled/i.test(
          message
        )
      ) {
        throw new NakamaApiError(message, 409);
      }

      throw new NakamaApiError(message, 400);
    }
  }

  /**
   * Single-write create/adopt path for agents: write raw SKILL.md under the profile
   * skills dir, upsert discovered metadata, and assign. Does not call createSkill
   * then createAndAssign (which would double-write).
   */
  async createAndAssignRawSkillToProfile(
    orgId: string,
    profileId: string,
    content: string,
    options?: {
      createdBy?: SkillCreatedBy;
      changeMeta?: ProfileChangeMeta;
      supportingFiles?: GitHubSkillBundle["files"];
    }
  ): Promise<SkillResponse & { created: boolean }> {
    const { name } = parseRawProfileSkillContent(content, orgId, profileId);
    const createdBy = options?.createdBy ?? "agent";
    const changeMeta = options?.changeMeta;

    const existingByName = await this.getMutableSkillByName(name, orgId);
    if (
      existingByName &&
      !isPathWithinProfileSkillsDir(orgId, profileId, existingByName.sourcePath)
    ) {
      throw new Error(
        `Skill "${name}" already exists at a different source path and cannot be attached to this profile.`
      );
    }

    if (
      existingByName &&
      isPathWithinProfileSkillsDir(orgId, profileId, existingByName.sourcePath)
    ) {
      const assigned = await this.db.listSkillsForProfile(profileId);
      if (assigned.some((skill) => skill.id === existingByName.id)) {
        const skillFile = path.join(existingByName.sourcePath, SKILL_FILE_NAME);
        const existingContent = await readFile(skillFile, "utf8");
        const nextContent = content.endsWith("\n") ? content : `${content}\n`;
        const normalizedExisting = existingContent.endsWith("\n")
          ? existingContent
          : `${existingContent}\n`;
        if (normalizedExisting !== nextContent) {
          throw new Error(
            `Skill "${name}" is already assigned to this profile. Use action patch or edit to update it.`
          );
        }
      }
    }

    // A reinstall may repair missing files, but must never overwrite local edits.
    if (options?.supportingFiles) {
      const directory = resolveProfileSkillDirectory(orgId, profileId, name);
      try {
        const existing = await readFile(
          path.join(directory, SKILL_FILE_NAME),
          "utf8"
        );
        if (existing.trimEnd() !== content.trimEnd()) {
          throw new Error(
            `Skill "${name}" already exists with different content.`
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    const missingFiles: GitHubSkillBundle["files"] = [];
    for (const file of options?.supportingFiles ?? []) {
      const { absolutePath } = resolveProfileSkillSupportingFilePath(
        orgId,
        profileId,
        name,
        file.path
      );
      try {
        const existing = await readFile(absolutePath);
        if (!existing.equals(Buffer.from(file.content))) {
          throw new Error(
            `Supporting file "${file.path}" already exists with different content.`
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        missingFiles.push(file);
      }
    }

    // Publish SKILL.md last. If a disk write fails, remove only files this call added.
    const addedPaths: string[] = [];
    let written: Awaited<ReturnType<typeof writeRawProfileSkillMarkdown>>;
    try {
      for (const file of missingFiles) {
        const added = await writeProfileSkillSupportingFile({
          content: file.content,
          name,
          orgId,
          overwrite: false,
          profileId,
          relativePath: file.path,
        });
        addedPaths.push(added.absolutePath);
      }
      written = await writeRawProfileSkillMarkdown({
        allowExisting: true,
        content,
        orgId,
        profileId,
      });
    } catch (error) {
      await Promise.all(addedPaths.map((file) => unlink(file)));
      throw error;
    }

    // written.directory came from resolveProfileSkillDirectory (containment already
    // enforced); syncSkillRecordFromDirectory keys off that same path.
    const record = await this.syncSkillRecordFromDirectory(
      written.directory,
      written.name,
      "written",
      createdBy
    );

    await withAssignmentChange(
      this.db,
      { field: "skills", meta: changeMeta, orgId, profileId },
      () => this.db.assignSkillToProfile(profileId, record.id)
    );

    const response = await this.getSkill(record.id);
    return { ...response, created: written.created };
  }

  async editAssignedProfileSkill(
    orgId: string,
    profileId: string,
    name: string,
    content: string,
    meta?: ProfileChangeMeta
  ): Promise<SkillResponse> {
    const skillName = assertValidSkillName(name);
    const { name: parsedName } = parseRawProfileSkillContent(
      content,
      orgId,
      profileId
    );

    if (parsedName !== skillName) {
      throw new Error(
        `Frontmatter name "${parsedName}" must match skill name "${skillName}".`
      );
    }

    const recordBefore = await this.assertProfileOwnedSkill(
      orgId,
      profileId,
      skillName
    );
    const beforeContent = meta
      ? await readFile(
          path.join(recordBefore.sourcePath, SKILL_FILE_NAME),
          "utf8"
        )
      : null;

    const written = await writeRawProfileSkillMarkdown({
      allowExisting: true,
      content,
      orgId,
      profileId,
    });

    if (written.created) {
      throw new Error(
        `Skill "${skillName}" was not found on disk; use action create instead of edit.`
      );
    }

    const record = await this.syncSkillRecordFromDirectory(
      written.directory,
      written.name,
      "patched"
    );

    await this.recordPatch(orgId, profileId, record.id);

    if (meta && beforeContent !== content) {
      await recordProfileChangeEvent(this.db, {
        actorUserId: meta.actorUserId,
        afterValue: content,
        beforeValue: beforeContent,
        field: "skills",
        orgId,
        profileId,
        source: meta.source,
      });
    }

    return this.getSkill(record.id);
  }

  async writeAssignedProfileSkillSupportingFile(
    orgId: string,
    profileId: string,
    name: string,
    relativePath: string,
    content: string
  ): Promise<{ skillName: string; relativePath: string }> {
    const skillName = assertValidSkillName(name);
    await this.assertProfileOwnedSkill(orgId, profileId, skillName);

    const written = await writeProfileSkillSupportingFile({
      content,
      name: skillName,
      orgId,
      profileId,
      relativePath,
    });

    return { relativePath: written.relativePath, skillName };
  }

  async removeAssignedProfileSkillSupportingFile(
    orgId: string,
    profileId: string,
    name: string,
    relativePath: string
  ): Promise<{ skillName: string; relativePath: string }> {
    const skillName = assertValidSkillName(name);
    await this.assertProfileOwnedSkill(orgId, profileId, skillName);

    const removed = await removeProfileSkillSupportingFile({
      name: skillName,
      orgId,
      profileId,
      relativePath,
    });

    return { relativePath: removed.relativePath, skillName };
  }

  async patchAssignedProfileSkill(
    orgId: string,
    profileId: string,
    name: string,
    oldString: string,
    newString: string,
    meta?: ProfileChangeMeta
  ): Promise<SkillResponse> {
    let beforeContent: string | null = null;
    if (meta) {
      const recordBefore = await this.assertProfileOwnedSkill(
        orgId,
        profileId,
        assertValidSkillName(name)
      );
      beforeContent = await readFile(
        path.join(recordBefore.sourcePath, SKILL_FILE_NAME),
        "utf8"
      );
    }

    const patched = await patchSkillFile({
      name,
      newString,
      oldString,
      orgId,
      profileId,
    });

    const record = await this.syncSkillRecordFromDirectory(
      patched.directory,
      patched.name,
      "patched"
    );

    await this.recordPatch(orgId, profileId, record.id);

    if (meta) {
      const afterContent = await readFile(
        path.join(record.sourcePath, SKILL_FILE_NAME),
        "utf8"
      );
      await recordProfileChangeEvent(this.db, {
        actorUserId: meta.actorUserId,
        afterValue: afterContent,
        beforeValue: beforeContent,
        field: "skills",
        orgId,
        profileId,
        source: meta.source,
      });
    }

    return this.getSkill(record.id);
  }

  async deleteAssignedProfileSkill(
    orgId: string,
    profileId: string,
    name: string,
    meta?: ProfileChangeMeta
  ): Promise<void> {
    const skillName = assertValidSkillName(name);
    assertNotBundledSkillName(skillName);

    const record = await this.getMutableSkillByName(skillName, orgId);
    if (!record) {
      throw new Error(`Skill "${skillName}" not found.`);
    }

    if (isPluginOwnedSkill(record)) {
      throw new Error("Plugin-owned skills cannot be deleted.");
    }

    if (isGlobalSkillSourcePath(record.sourcePath)) {
      throw new Error("Global skills cannot be deleted by agents.");
    }

    if (!isPathWithinProfileSkillsDir(orgId, profileId, record.sourcePath)) {
      throw new Error(
        `Skill "${skillName}" is not owned by this profile and cannot be deleted.`
      );
    }

    await withAssignmentChange(
      this.db,
      { field: "skills", meta, orgId, profileId },
      async () => {
        await this.db.unassignSkillFromProfile(profileId, record.id);
        const deleted = await this.db.deleteSkill(record.id);

        if (!deleted) {
          throw new Error("Skill not found.");
        }

        await deleteSkillDirectory(record.sourcePath);
      }
    );
  }

  async unassignArchivedProfileSkill(
    orgId: string,
    profileId: string,
    skillId: string,
    archivedDirectory: string
  ): Promise<void> {
    const record = await this.requireSkill(skillId);

    if (isPluginOwnedSkill(record)) {
      throw new Error("Plugin-owned skills cannot be archived.");
    }

    if (isGlobalSkillSourcePath(record.sourcePath)) {
      throw new Error("Global skills cannot be archived by the curator.");
    }

    if (!isPathWithinProfileSkillsDir(orgId, profileId, archivedDirectory)) {
      throw new Error(
        "Archived skill path is outside the profile skills directory."
      );
    }

    await this.db.upsertSkill({
      ...record,
      sourcePath: archivedDirectory,
      updatedAt: new Date().toISOString(),
    });

    try {
      await this.db.unassignSkillFromProfile(profileId, skillId);
    } catch (error) {
      await this.db.upsertSkill(record);
      throw error;
    }
  }

  async deleteSkill(skillId: string): Promise<void> {
    const record = await this.requireSkill(skillId);

    if (isPluginOwnedSkill(record)) {
      throw new Error("Plugin-owned skills cannot be deleted.");
    }

    if (bundledSkillNames.has(record.name)) {
      throw new Error("Bundled system skills cannot be deleted.");
    }

    if (record.sourcePath) {
      await deleteSkillDirectory(record.sourcePath);
    }

    const deleted = await this.db.deleteSkill(skillId);

    if (!deleted) {
      throw new Error("Skill not found.");
    }
  }

  async getSkill(skillId: string, orgId?: string): Promise<SkillResponse> {
    const record = await this.requireSkill(skillId);
    if (orgId && record.orgId && record.orgId !== orgId) {
      throw new NakamaApiError("Skill not found.", 404);
    }
    const directory = await this.resolveSkillDirectory(record);
    const discovered = directory
      ? await discoverSkillDirectory(directory)
      : null;
    const body =
      discovered?.body ?? (await readSkillBody(directory ?? record.sourcePath));

    return {
      skill: {
        ...toSkillSummary(record),
        body,
      },
    };
  }

  private async skillFilesRoot(
    orgId: string,
    skillId: string
  ): Promise<string> {
    const record = await this.db.getSkill(skillId);
    if (!record || (record.orgId && record.orgId !== orgId)) {
      throw new NakamaApiError("Skill not found.", 404);
    }
    const directory = await this.resolveSkillDirectory(record);
    if (!directory) {
      throw new NakamaApiError("Skill files are unavailable.", 404);
    }
    try {
      return await realpath(directory);
    } catch {
      throw new NakamaApiError("Skill files are unavailable.", 404);
    }
  }

  async listSkillFiles(
    orgId: string,
    skillId: string
  ): Promise<SkillFilesResponse> {
    const root = await this.skillFilesRoot(orgId, skillId);
    const files: SkillFilesResponse["files"] = [];
    let truncated = false;
    async function visit(
      directory: string,
      prefix: string,
      depth: number
    ): Promise<void> {
      if (depth > 12) {
        truncated = true;
        return;
      }
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name)
      );
      for (const entry of entries) {
        if (
          entry.isSymbolicLink() ||
          !(entry.isDirectory() || entry.isFile())
        ) {
          continue;
        }
        if (files.length >= 1000) {
          truncated = true;
          return;
        }
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        files.push({
          path: relative,
          type: entry.isDirectory() ? "directory" : "file",
        });
        if (entry.isDirectory()) {
          await visit(path.join(directory, entry.name), relative, depth + 1);
        }
      }
    }
    await visit(root, "", 0);
    return { files, truncated };
  }

  async readSkillFile(
    orgId: string,
    skillId: string,
    filePath: string
  ): Promise<SkillFileResponse> {
    const root = await this.skillFilesRoot(orgId, skillId);
    if (
      !filePath ||
      filePath.includes("\0") ||
      filePath.includes("\\") ||
      path.isAbsolute(filePath) ||
      filePath.split("/").includes("..")
    ) {
      throw new NakamaApiError("Invalid skill file path.", 400);
    }
    let target: string;
    try {
      target = await realpath(path.join(root, filePath));
    } catch {
      throw new NakamaApiError("Skill file not found.", 404);
    }
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new NakamaApiError("File is outside the skill directory.", 403);
    }
    const handle = await open(target, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new NakamaApiError("Select a file.", 400);
      }
      const maxBytes = 1024 * 1024;
      if (stat.size > maxBytes) {
        return {
          content: null,
          path: filePath,
          unavailableReason: "Preview is limited to files up to 1 MB.",
        };
      }
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) {
        return {
          content: null,
          path: filePath,
          unavailableReason: "Preview is limited to files up to 1 MB.",
        };
      }
      const bytes = buffer.subarray(0, bytesRead);
      const mediaType = inferArtifactMimeType(filePath);
      if (mediaType.startsWith("image/")) {
        return {
          content: null,
          image: { dataBase64: bytes.toString("base64"), mediaType },
          path: filePath,
        };
      }
      try {
        if (bytes.includes(0)) {
          throw new Error("Binary file");
        }
        return {
          content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          path: filePath,
        };
      } catch {
        return {
          content: null,
          path: filePath,
          unavailableReason: "Preview is unavailable for binary files.",
        };
      }
    } finally {
      await handle.close();
    }
  }

  async composeCatalogForProfile(
    orgId: string,
    profileId: string,
    usageContext?: SkillUsageRecordingContext,
    // False in a cognito session: a usage row records which skills the chat
    // touched, which is a durable trace of what it was about.
    recordUsage = true
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    const skillIds = assigned
      .map((item) => item.record.id)
      .filter((skillId): skillId is string => Boolean(skillId));

    if (recordUsage) {
      void this.recordCatalogViews(orgId, profileId, skillIds, usageContext);
    }

    return composeSkillsCatalog(assigned.map((item) => item.discovered));
  }

  async composeAgentBrowserCapabilityForProfile(
    orgId: string,
    profileId: string
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    return composeAgentBrowserCapabilityPrompt(
      assigned.map((item) => item.discovered)
    );
  }

  async formatMatchedSkillsForPrompt(
    orgId: string,
    profileId: string,
    userMessage: string,
    options: {
      appendContext?: (matched: DiscoveredSkill[]) => string | Promise<string>;
      /** False in a cognito session, for the same reason as the catalog. */
      recordUsage?: boolean;
      usageContext?: SkillUsageRecordingContext;
    } = {}
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    const discovered = assigned.map((item) => item.discovered);
    const matched = matchSkillsForMessage(discovered, userMessage);
    const explicitSkillName = extractExplicitSkillName(userMessage);

    if (matched.length > 0) {
      const matchedSkillIds = matched
        .map(
          (skill) =>
            assigned.find(
              (entry) => entry.discovered.directory === skill.directory
            )?.record.id
        )
        .filter((skillId): skillId is string => Boolean(skillId));

      if (options.recordUsage !== false) {
        void this.recordMatches(orgId, profileId, matchedSkillIds);
      }
    }

    const prompt = composeMatchedSkillsPrompt(matched, {
      explicitInvocation: explicitSkillName !== null,
    });
    const extraContext =
      matched.length > 0 ? await options.appendContext?.(matched) : "";

    return [prompt, extraContext?.trim()].filter(Boolean).join("\n\n");
  }

  async listSkillSummariesForProfile(
    orgId: string,
    profileId: string
  ): Promise<SkillSummary[]> {
    const records = await this.db.listSkillsForProfile(profileId);
    const usage = await this.listSkillUsageForProfile(profileId);
    return toSkillSummaries(records, usage);
  }

  async loadToolsForProfile(
    orgId: string,
    profileId: string
  ): Promise<ToolDefinition[]> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    const skillTools = assigned.filter(
      (item) => !isPluginOwnedSkill(item.record) && item.discovered.hasTool
    );
    const javascriptTools = await loadSkillTools(
      skillTools
        .filter((item) => !item.discovered.toolPath?.endsWith(".py"))
        .map((item) => item.discovered)
    );
    const pythonTools = await Promise.all(
      skillTools
        .filter((item) => item.discovered.toolPath?.endsWith(".py"))
        .map((item) => loadPythonSkillTool(item.discovered))
    );
    // Scripts named in `scripts:` each become their own tool, so a skill is no
    // longer capped at the single tool.py slot.
    const declaredTools = await Promise.all(
      assigned
        .filter((item) => !isPluginOwnedSkill(item.record))
        .flatMap((item) =>
          item.discovered.scriptTools.map((script) =>
            loadPythonSkillTool(item.discovered, script)
          )
        )
    );
    return [
      ...javascriptTools,
      ...[...pythonTools, ...declaredTools].filter(
        (tool): tool is ToolDefinition => tool !== null
      ),
    ];
  }

  async listSkillsForProfile(profileId: string): Promise<SkillSummary[]> {
    const skills = await this.db.listSkillsForProfile(profileId);
    return skills.map((record) => toSkillSummary(record));
  }

  async recordCatalogViews(
    orgId: string,
    profileId: string,
    skillIds: string[],
    context?: SkillUsageRecordingContext
  ): Promise<void> {
    if (skillIds.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    for (const skillId of skillIds) {
      if (context) {
        const dedupeKey = `${context.sessionId}:${skillId}`;
        if (context.seenCatalogSkillIds.has(dedupeKey)) {
          continue;
        }

        context.seenCatalogSkillIds.add(dedupeKey);
      }

      await this.safeIncrementSkillUsage({
        orgId,
        profileId,
        skillId,
        viewDelta: 1,
        viewedAt: now,
      });
    }
  }

  async recordMatches(
    orgId: string,
    profileId: string,
    skillIds: string[]
  ): Promise<void> {
    if (skillIds.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    for (const skillId of skillIds) {
      await this.safeIncrementSkillUsage({
        orgId,
        profileId,
        skillId,
        useDelta: 1,
        usedAt: now,
      });
    }
  }

  async recordPatch(
    orgId: string,
    profileId: string,
    skillId: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.safeIncrementSkillUsage({
      orgId,
      patchDelta: 1,
      patchedAt: now,
      profileId,
      skillId,
    });
  }

  async listSkillUsageForProfile(profileId: string) {
    return this.db.listSkillUsageForProfile(profileId);
  }

  private async safeIncrementSkillUsage(input: {
    orgId: string;
    profileId: string;
    skillId: string;
    viewDelta?: number;
    useDelta?: number;
    patchDelta?: number;
    viewedAt?: string;
    usedAt?: string;
    patchedAt?: string;
  }): Promise<void> {
    try {
      const assigned = await this.db.listSkillsForProfile(input.profileId);
      if (!assigned.some((skill) => skill.id === input.skillId)) {
        return;
      }

      await this.db.incrementSkillUsage(input);
    } catch (error) {
      console.error("Failed to record skill usage:", error);
    }
  }

  async materializeAssignedPluginSkills(
    orgId: string,
    profileId: string
  ): Promise<void> {
    await this.getAssignedDiscoveredSkills(orgId, profileId);
  }

  private async copyPluginSkillToProfile(
    orgId: string,
    profileId: string,
    record: StoredSkillRecord
  ): Promise<string | null> {
    const profile = await this.db.getProfile(profileId);
    if (profile?.orgId !== orgId || record.orgId !== orgId) {
      return null;
    }
    const source = await this.resolveSkillDirectory(record);
    if (!source) {
      return null;
    }

    // Releases are immutable. A new release gets a new copy, and concurrent
    // readers only see complete bundles. Nesting prevents standalone discovery.
    const version = createHash("sha256").update(source).digest("hex");
    const workspace = getProfileSoulDir(orgId, profileId);
    await mkdir(workspace, { mode: 0o700, recursive: true });
    const parent = path.join(workspace, "skills", ".plugins");
    const directory = path.join(parent, version);
    await guardFilePath(directory, null, undefined, { cwd: workspace });
    await guardFilePath(
      path.join(directory, SKILL_FILE_NAME),
      null,
      undefined,
      { cwd: workspace }
    );
    if (await pathExists(path.join(directory, SKILL_FILE_NAME))) {
      return directory;
    }

    await mkdir(parent, { mode: 0o700, recursive: true });
    const staging = await mkdtemp(path.join(parent, ".copy-"));
    try {
      await cp(source, staging, {
        filter: async (file) => {
          if ((await lstat(file)).isSymbolicLink()) {
            throw new Error(
              "Plugin skill bundles cannot contain symbolic links."
            );
          }
          return true;
        },
        recursive: true,
      });
      try {
        await rename(staging, directory);
      } catch (error) {
        // Another request may have published the same immutable release.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY") {
          throw error;
        }
      }
      return directory;
    } finally {
      await rm(staging, { force: true, recursive: true });
    }
  }

  private async getAssignedDiscoveredSkills(
    orgId: string,
    profileId: string
  ): Promise<
    Array<{ discovered: DiscoveredSkill; record: StoredSkillRecord }>
  > {
    // Serialize copies and removals so an in-flight prompt cannot restore a
    // revoked skill after cleanup has completed.
    const key = JSON.stringify([orgId, profileId]);
    const previous = this.profileSkillSyncs.get(key) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() => this.syncAssignedDiscoveredSkills(orgId, profileId));
    this.profileSkillSyncs.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.profileSkillSyncs.get(key) === pending) {
        this.profileSkillSyncs.delete(key);
      }
    }
  }

  private async syncAssignedDiscoveredSkills(
    orgId: string,
    profileId: string
  ): Promise<
    Array<{ discovered: DiscoveredSkill; record: StoredSkillRecord }>
  > {
    const assigned = await this.db.listSkillsForProfile(profileId);
    const discovered = await discoverSkills({ orgId, profileId });
    const bySourcePath = new Map(
      discovered.map((skill) => [skill.directory, skill])
    );
    const standaloneByName = new Map(
      discovered.map((skill) => [skill.name, skill])
    );
    const resolved: Array<{
      discovered: DiscoveredSkill;
      record: StoredSkillRecord;
    }> = [];

    for (const record of assigned) {
      if (isPluginOwnedSkill(record)) {
        const directory = await this.copyPluginSkillToProfile(
          orgId,
          profileId,
          record
        );
        if (!directory) {
          continue;
        }
        const pluginSkill = await discoverSkillDirectory(directory);
        if (!pluginSkill) {
          continue;
        }
        resolved.push({
          discovered: { ...pluginSkill, hasTool: false, toolPath: null },
          record,
        });
        continue;
      }

      const match =
        bySourcePath.get(record.sourcePath) ??
        standaloneByName.get(record.name) ??
        null;
      if (match) {
        resolved.push({ discovered: match, record });
      }
    }

    await this.prunePluginSkillCopies(
      orgId,
      profileId,
      new Set(
        resolved
          .filter((item) => isPluginOwnedSkill(item.record))
          .map((item) => item.discovered.directory)
      )
    );
    return resolved;
  }

  private async prunePluginSkillCopies(
    orgId: string,
    profileId: string,
    retained: Set<string>
  ): Promise<void> {
    const profile = await this.db.getProfile(profileId);
    if (profile?.orgId !== orgId || !this.pluginService) {
      return;
    }
    const workspace = getProfileSoulDir(orgId, profileId);
    const parent = path.join(workspace, "skills", ".plugins");
    if (!(await pathExists(parent))) {
      return;
    }
    await guardFilePath(parent, null, undefined, { cwd: workspace });
    for (const entry of await readdir(parent)) {
      const directory = path.join(parent, entry);
      // Only delete host-generated release copies, never unrelated files.
      if (/^[a-f0-9]{64}$/.test(entry) && !retained.has(directory)) {
        await guardFilePath(directory, null, undefined, { cwd: workspace });
        await rm(directory, { force: true, recursive: true });
      }
    }
  }

  private async resolveSkillDirectory(
    record: StoredSkillRecord
  ): Promise<string | null> {
    if (isPluginOwnedSkill(record) && record.pluginId && record.pluginKey) {
      if (!(this.pluginService && record.orgId)) {
        return null;
      }
      return this.pluginService.resolveEnabledSkillDirectory(
        record.orgId,
        record.pluginId,
        record.pluginKey
      );
    }
    return record.sourcePath;
  }

  private async getMutableSkillByName(
    name: string,
    orgId: string
  ): Promise<StoredSkillRecord | null> {
    const skills = await this.db.listSkills();
    return (
      skills.find(
        (skill) =>
          skill.name === name &&
          !isPluginOwnedSkill(skill) &&
          (skill.orgId === orgId || skill.orgId == null)
      ) ?? null
    );
  }

  private async syncSkillRecordFromDirectory(
    directory: string,
    name: string,
    verb: "written" | "patched",
    createdBy?: SkillCreatedBy
  ): Promise<StoredSkillRecord> {
    const discovered = await discoverSkillDirectory(directory);
    if (!discovered) {
      throw new Error(`Skill was ${verb} but could not be discovered.`);
    }

    await this.upsertDiscoveredSkill(discovered, createdBy);

    const record =
      (await this.db.getSkillBySourcePath(directory)) ??
      (await this.getMutableSkillByName(
        name,
        orgIdFromSkillSourcePath(directory) ?? ""
      ));

    if (!record) {
      throw new Error(`Skill was ${verb} but could not be synced.`);
    }

    if (createdBy && record.createdBy !== createdBy) {
      const now = new Date().toISOString();
      const updated = { ...record, createdBy, updatedAt: now };
      await this.db.upsertSkill(updated);
      return updated;
    }

    return record;
  }

  private async upsertDiscoveredSkill(
    skill: DiscoveredSkill,
    createdByOverride?: SkillCreatedBy
  ): Promise<{ created: boolean }> {
    const existingByPath = await this.db.getSkillBySourcePath(skill.directory);
    const existingByName = existingByPath
      ? null
      : await this.db.getSkillByName(
          skill.name,
          orgIdFromSkillSourcePath(skill.directory)
        );
    const existing =
      existingByPath ??
      (existingByName && !isPluginOwnedSkill(existingByName)
        ? existingByName
        : null);
    const now = new Date().toISOString();
    const defaultCreatedBy: SkillCreatedBy = isGlobalSkillSourcePath(
      skill.directory
    )
      ? "bundled"
      : "human";
    const sourcePath = existing
      ? pickPreferredSkillSourcePath(existing.sourcePath, skill.directory)
      : skill.directory;
    const record: StoredSkillRecord = {
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? createdByOverride ?? defaultCreatedBy,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
      enabled: existing?.enabled ?? true,
      hasTool: skill.hasTool,
      id: existing?.id ?? createId("skill"),
      name: skill.name,
      // Ownership always follows the winning path, so org_id cannot drift from it.
      orgId: orgIdFromSkillSourcePath(sourcePath),
      sourcePath,
      updatedAt: now,
    };

    await this.db.upsertSkill(record);

    return { created: existing === null };
  }

  private async requireSkill(skillId: string): Promise<StoredSkillRecord> {
    const skill = await this.db.getSkill(skillId);

    if (!skill) {
      throw new Error("Skill not found.");
    }

    return skill;
  }

  private async assertProfileOwnedSkill(
    orgId: string,
    profileId: string,
    name: string
  ): Promise<StoredSkillRecord> {
    assertNotBundledSkillName(name);

    const record = await this.getMutableSkillByName(name, orgId);
    if (!record) {
      throw new Error(`Skill "${name}" not found.`);
    }

    if (isPluginOwnedSkill(record)) {
      throw new Error("Plugin-owned skills cannot be edited.");
    }

    if (isGlobalSkillSourcePath(record.sourcePath)) {
      throw new Error("Global skills cannot be modified by agents.");
    }

    if (!isPathWithinProfileSkillsDir(orgId, profileId, record.sourcePath)) {
      throw new Error(`Skill "${name}" is not owned by this profile.`);
    }

    const skillFile = path.join(record.sourcePath, SKILL_FILE_NAME);
    try {
      await readFile(skillFile, "utf8");
    } catch {
      throw new Error(`Skill "${name}" is missing SKILL.md on disk.`);
    }

    return record;
  }

  private async consolidateDuplicateSkills(): Promise<void> {
    const skills = await this.db.listSkills();
    const grouped = new Map<string, StoredSkillRecord[]>();

    for (const skill of skills) {
      if (isPluginOwnedSkill(skill)) {
        continue;
      }
      const group = grouped.get(skill.name) ?? [];
      group.push(skill);
      grouped.set(skill.name, group);
    }

    const profiles = await this.db.listProfiles();

    for (const group of grouped.values()) {
      if (group.length <= 1) {
        continue;
      }

      const canonical = dedupeSkillsByName(group)[0];
      if (!canonical) {
        continue;
      }

      const duplicates = group.filter((skill) => skill.id !== canonical.id);

      for (const profile of profiles) {
        const assigned = await this.db.listSkillsForProfile(profile.id);

        for (const assignedSkill of assigned) {
          if (
            !duplicates.some((duplicate) => duplicate.id === assignedSkill.id)
          ) {
            continue;
          }

          await this.db.assignSkillToProfile(profile.id, canonical.id);
          await this.db.unassignSkillFromProfile(profile.id, assignedSkill.id);
        }
      }

      for (const duplicate of duplicates) {
        await this.db.deleteSkill(duplicate.id);
      }
    }
  }
}

function toSkillSummary(
  record: StoredSkillRecord,
  usage?: StoredSkillUsageRecord | null
): SkillSummary {
  return {
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    description: record.description,
    disableModelInvocation: record.disableModelInvocation,
    enabled: record.enabled,
    hasTool: record.hasTool,
    id: record.id,
    name: record.name,
    orgId: record.orgId ?? null,
    pluginId: record.pluginId ?? null,
    pluginKey: record.pluginKey ?? null,
    sourcePath: record.sourcePath,
    updatedAt: record.updatedAt,
    usage: usage ? toSkillUsageSummary(usage) : undefined,
  };
}

function toSkillUsageSummary(
  record: StoredSkillUsageRecord | null | undefined
): SkillUsageSummary {
  if (!record) {
    return {
      lastPatchedAt: null,
      lastUsedAt: null,
      lastViewedAt: null,
      patchCount: 0,
      useCount: 0,
      viewCount: 0,
    };
  }

  return {
    lastPatchedAt: record.lastPatchedAt,
    lastUsedAt: record.lastUsedAt,
    lastViewedAt: record.lastViewedAt,
    patchCount: record.patchCount,
    useCount: record.useCount,
    viewCount: record.viewCount,
  };
}

async function readSkillBody(sourcePath: string): Promise<string> {
  try {
    const content = await readFile(`${sourcePath}/SKILL.md`, "utf8");
    const bodyMatch = content.match(
      /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/
    );
    return bodyMatch?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

export function toSkillSummaries(
  records: StoredSkillRecord[],
  usageRecords: StoredSkillUsageRecord[] = []
): SkillSummary[] {
  const usageBySkillId = new Map(
    usageRecords.map((usage) => [usage.skillId, usage])
  );
  return records.map((record) => ({
    ...toSkillSummary(record, usageBySkillId.get(record.id) ?? null),
    usage: toSkillUsageSummary(usageBySkillId.get(record.id)),
  }));
}
