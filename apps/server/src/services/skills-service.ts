import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CreateSkillRequest,
  ListSkillsResponse,
  SkillDetail,
  SkillResponse,
  SkillSummary,
  SyncSkillsResponse,
  ToolDefinition,
} from "@nakama/core";
import {
  composeMatchedSkillsPrompt,
  composeSkillsCatalog,
  createId,
  createSkillFile,
  dedupeSkillsByName,
  deleteSkillDirectory,
  discoverSkillDirectory,
  discoverSkills,
  extractExplicitSkillName,
  isGlobalSkillSourcePath,
  loadSkillTools,
  matchSkillsForMessage,
  pickPreferredSkillSourcePath,
  type DiscoveredSkill,
} from "@nakama/core";
import type { DatabaseAdapter, StoredSkillRecord } from "@nakama/db";

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
      discovered: discovered.length,
      created,
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

  async createSkill(orgId: string, request: CreateSkillRequest): Promise<SkillResponse> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("Skill name is required.");
    }

    if (!request.description.trim()) {
      throw new Error("Skill description is required.");
    }

    const profileId = request.profileId?.trim() || undefined;
    const directory = await createSkillFile({
      name,
      description: request.description.trim(),
      body: request.body,
      disableModelInvocation: request.disableModelInvocation,
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

  async createAndAssignSkillToProfile(
    orgId: string,
    profileId: string,
    request: Omit<CreateSkillRequest, "profileId">,
  ): Promise<SkillResponse> {
    const created = await this.createSkill(orgId, {
      ...request,
      profileId,
    });

    await this.db.assignSkillToProfile(profileId, created.skill.id);

    return created;
  }

  async deleteSkill(skillId: string): Promise<void> {
    const record = await this.requireSkill(skillId);

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

  async composeCatalogForProfile(orgId: string, profileId: string): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    return composeSkillsCatalog(assigned);
  }

  async formatMatchedSkillsForPrompt(
    orgId: string,
    profileId: string,
    userMessage: string,
    options: {
      appendContext?: (matched: DiscoveredSkill[]) => string | Promise<string>;
    } = {},
  ): Promise<string> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    const matched = matchSkillsForMessage(assigned, userMessage);
    const explicitSkillName = extractExplicitSkillName(userMessage);
    const prompt = composeMatchedSkillsPrompt(matched, {
      explicitInvocation: explicitSkillName !== null,
    });
    const extraContext =
      matched.length > 0 ? await options.appendContext?.(matched) : "";

    return [prompt, extraContext?.trim()].filter(Boolean).join("\n\n");
  }

  async loadToolsForProfile(orgId: string, profileId: string): Promise<ToolDefinition[]> {
    const assigned = await this.getAssignedDiscoveredSkills(orgId, profileId);
    return loadSkillTools(assigned.filter((skill) => skill.hasTool));
  }

  async listSkillsForProfile(profileId: string): Promise<SkillSummary[]> {
    const skills = await this.db.listSkillsForProfile(profileId);
    return skills.map(toSkillSummary);
  }

  private async getAssignedDiscoveredSkills(
    orgId: string,
    profileId: string,
  ): Promise<DiscoveredSkill[]> {
    const assigned = await this.db.listSkillsForProfile(profileId);
    const discovered = await discoverSkills({ orgId, profileId });
    const bySourcePath = new Map(discovered.map((skill) => [skill.directory, skill]));
    const byName = new Map(discovered.map((skill) => [skill.name, skill]));

    return assigned
      .map(
        (record) =>
          bySourcePath.get(record.sourcePath) ?? byName.get(record.name) ?? null,
      )
      .filter((skill): skill is DiscoveredSkill => skill !== null);
  }

  private async upsertDiscoveredSkill(
    skill: DiscoveredSkill,
  ): Promise<{ created: boolean }> {
    const existingByPath = await this.db.getSkillBySourcePath(skill.directory);
    const existing =
      existingByPath ?? (await this.db.getSkillByName(skill.name)) ?? null;
    const now = new Date().toISOString();
    const record: StoredSkillRecord = {
      id: existing?.id ?? createId("skill"),
      name: skill.name,
      description: skill.description,
      sourcePath: existing
        ? pickPreferredSkillSourcePath(existing.sourcePath, skill.directory)
        : skill.directory,
      hasTool: skill.hasTool,
      disableModelInvocation: skill.disableModelInvocation,
      enabled: existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
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
          if (!duplicates.some((duplicate) => duplicate.id === assignedSkill.id)) {
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

function toSkillSummary(record: StoredSkillRecord): SkillSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    sourcePath: record.sourcePath,
    hasTool: record.hasTool,
    disableModelInvocation: record.disableModelInvocation,
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function readSkillBody(record: StoredSkillRecord): Promise<string> {
  try {
    const content = await readFile(`${record.sourcePath}/SKILL.md`, "utf8");
    const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    return bodyMatch?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

export function toSkillSummaries(records: StoredSkillRecord[]): SkillSummary[] {
  return records.map(toSkillSummary);
}

export function toSkillDetail(
  record: StoredSkillRecord,
  body = "",
): SkillDetail {
  return {
    ...toSkillSummary(record),
    body,
  };
}
