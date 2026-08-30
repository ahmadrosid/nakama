import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CreateSkillRequest,
  InstallSkillRequest,
  ListSkillsResponse,
  PatchSkillRequest,
  SkillDetail,
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
  fetchGitHubSkillMarkdown,
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
  removeProfileSkillSupportingFile,
  SKILL_FILE_NAME,
  writeProfileSkillSupportingFile,
  writeRawProfileSkillMarkdown,
} from "@nakama/core";
import type {
  DatabaseAdapter,
  SkillCreatedBy,
  StoredSkillRecord,
  StoredSkillUsageRecord,
} from "@nakama/db";
import {
  type ProfileChangeMeta,
  recordProfileChangeEvent,
  withAssignmentChange,
} from "./profile-change-history";

export interface SkillUsageRecordingContext {
  seenCatalogSkillIds: Set<string>;
  sessionId: string;
}

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

export class SkillsService {
  constructor(private readonly db: DatabaseAdapter) {}

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

  async listSkills(): Promise<ListSkillsResponse> {
    await this.syncDiscoveredSkills();

    const profiles = await this.db.listProfiles();

    for (const profile of profiles) {
      if (!profile.orgId) {
        continue;
      }

      await this.syncProfileSkills(profile.orgId, profile.id);
    }

    const skills = await this.db.listSkills();
    return { skills: skills.map(toSkillSummary) };
  }

  async createSkill(
    orgId: string,
    request: CreateSkillRequest
  ): Promise<SkillResponse> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("Skill name is required.");
    }

    if (!request.description.trim()) {
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

    if (!profileId) {
      throw new NakamaApiError("profileId is required.", 400);
    }

    if (!url) {
      throw new NakamaApiError("url is required.", 400);
    }

    const profile = await this.db.getProfileForOrg(profileId, orgId);
    if (!profile) {
      throw new NakamaApiError("Profile not found.", 404);
    }

    const content = await fetchGitHubSkillMarkdown(url);

    try {
      parseSkillMarkdown(content, url);
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
        { createdBy: "human" }
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
    options?: { createdBy?: SkillCreatedBy; changeMeta?: ProfileChangeMeta }
  ): Promise<SkillResponse & { created: boolean }> {
    const { name } = parseRawProfileSkillContent(content, orgId, profileId);
    const createdBy = options?.createdBy ?? "agent";
    const changeMeta = options?.changeMeta;

    const existingByName = await this.db.getSkillByName(name, orgId);
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

    const written = await writeRawProfileSkillMarkdown({
      allowExisting: true,
      content,
      orgId,
      profileId,
    });

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

    const record = await this.db.getSkillByName(skillName, orgId);
    if (!record) {
      throw new Error(`Skill "${skillName}" not found.`);
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

  async getSkill(skillId: string): Promise<SkillResponse> {
    const record = await this.requireSkill(skillId);
    const discovered = await discoverSkillDirectory(record.sourcePath);
    const body = discovered?.body ?? (await readSkillBody(record));

    return {
      skill: {
        ...toSkillSummary(record),
        body,
      },
    };
  }

  async composeCatalogForProfile(
    orgId: string,
    profileId: string,
    usageContext?: SkillUsageRecordingContext
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    const assignedRecords = await this.db.listSkillsForProfile(profileId);
    const skillIds = assigned
      .map(
        (skill) =>
          assignedRecords.find((record) => record.name === skill.name)?.id
      )
      .filter((skillId): skillId is string => Boolean(skillId));

    void this.recordCatalogViews(orgId, profileId, skillIds, usageContext);

    return composeSkillsCatalog(assigned);
  }

  async composeAgentBrowserCapabilityForProfile(
    orgId: string,
    profileId: string
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    return composeAgentBrowserCapabilityPrompt(assigned);
  }

  async formatMatchedSkillsForPrompt(
    orgId: string,
    profileId: string,
    userMessage: string,
    options: {
      appendContext?: (matched: DiscoveredSkill[]) => string | Promise<string>;
      usageContext?: SkillUsageRecordingContext;
    } = {}
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    const assignedRecords = await this.db.listSkillsForProfile(profileId);
    const matched = matchSkillsForMessage(assigned, userMessage);
    const explicitSkillName = extractExplicitSkillName(userMessage);

    if (matched.length > 0) {
      const matchedSkillIds = matched
        .map(
          (skill) =>
            assignedRecords.find((record) => record.name === skill.name)?.id
        )
        .filter((skillId): skillId is string => Boolean(skillId));

      void this.recordMatches(orgId, profileId, matchedSkillIds);
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
    return loadSkillTools(assigned.filter((skill) => skill.hasTool));
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

  private async getAssignedDiscoveredSkills(
    orgId: string,
    profileId: string
  ): Promise<DiscoveredSkill[]> {
    const assigned = await this.db.listSkillsForProfile(profileId);
    const discovered = await discoverSkills({ orgId, profileId });
    const bySourcePath = new Map(
      discovered.map((skill) => [skill.directory, skill])
    );
    const byName = new Map(discovered.map((skill) => [skill.name, skill]));

    return assigned
      .map(
        (record) =>
          bySourcePath.get(record.sourcePath) ?? byName.get(record.name) ?? null
      )
      .filter((skill): skill is DiscoveredSkill => skill !== null);
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
      (await this.db.getSkillByName(name, orgIdFromSkillSourcePath(directory)));

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
    const existing =
      existingByPath ??
      (await this.db.getSkillByName(
        skill.name,
        orgIdFromSkillSourcePath(skill.directory)
      )) ??
      null;
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

    const record = await this.db.getSkillByName(name, orgId);
    if (!record) {
      throw new Error(`Skill "${name}" not found.`);
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

async function readSkillBody(record: StoredSkillRecord): Promise<string> {
  try {
    const content = await readFile(`${record.sourcePath}/SKILL.md`, "utf8");
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

export function toSkillDetail(
  record: StoredSkillRecord,
  body = ""
): SkillDetail {
  return {
    ...toSkillSummary(record),
    body,
  };
}
