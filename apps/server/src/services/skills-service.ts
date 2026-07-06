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
  deleteSkillDirectory,
  discoverSkills,
  extractExplicitSkillName,
  getGlobalSkillsDir,
  getProfileSkillsDir,
  loadSkillTools,
  matchSkillsForMessage,
  type DiscoveredSkill,
} from "@nakama/core";
import type { DatabaseAdapter, StoredSkillRecord } from "@nakama/db";

export class SkillsService {
  private discoveredCache: DiscoveredSkill[] | null = null;

  constructor(private readonly db: DatabaseAdapter) {}

  async syncDiscoveredSkills(): Promise<SyncSkillsResponse> {
    const discovered = await this.refreshDiscoveryCache();
    let created = 0;
    let updated = 0;

    for (const skill of discovered) {
      const existing = await this.db.getSkillBySourcePath(skill.directory);
      const now = new Date().toISOString();
      const record: StoredSkillRecord = {
        id: existing?.id ?? createId("skill"),
        name: skill.name,
        description: skill.description,
        sourcePath: skill.directory,
        hasTool: skill.hasTool,
        disableModelInvocation: skill.disableModelInvocation,
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }

      await this.db.upsertSkill(record);
    }

    return {
      discovered: discovered.length,
      created,
      updated,
    };
  }

  async listSkills(): Promise<ListSkillsResponse> {
    await this.syncDiscoveredSkills();
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

    await createSkillFile({
      name,
      description: request.description.trim(),
      body: request.body,
      disableModelInvocation: request.disableModelInvocation,
      orgId: profileId ? orgId : undefined,
      profileId,
    });

    await this.syncDiscoveredSkills();

    const sourcePath = profileId
      ? getProfileSkillsDir(orgId, profileId)
      : getGlobalSkillsDir();
    const record = await this.db.getSkillBySourcePath(path.join(sourcePath, name));

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

    this.discoveredCache = null;
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    const record = await this.requireSkill(skillId);
    const discovered = await this.getDiscoveredSkill(record.sourcePath);
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
    const discovered = await this.getDiscoveryCache();
    const bySourcePath = new Map(discovered.map((skill) => [skill.directory, skill]));

    return assigned
      .map((record) => bySourcePath.get(record.sourcePath))
      .filter((skill): skill is DiscoveredSkill => skill !== undefined);
  }

  private async refreshDiscoveryCache(): Promise<DiscoveredSkill[]> {
    this.discoveredCache = await discoverSkills();
    return this.discoveredCache;
  }

  private async getDiscoveryCache(): Promise<DiscoveredSkill[]> {
    if (!this.discoveredCache) {
      return this.refreshDiscoveryCache();
    }

    return this.discoveredCache;
  }

  private async getDiscoveredSkill(sourcePath: string): Promise<DiscoveredSkill | null> {
    const discovered = await this.getDiscoveryCache();
    return discovered.find((skill) => skill.directory === sourcePath) ?? null;
  }

  private async requireSkill(skillId: string): Promise<StoredSkillRecord> {
    const skill = await this.db.getSkill(skillId);

    if (!skill) {
      throw new Error("Skill not found.");
    }

    return skill;
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
