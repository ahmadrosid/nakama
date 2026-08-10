import type { DatabaseAdapter } from "@nakama/db";

export interface SkillUsageRecordingContext {
  seenCatalogSkillIds: Set<string>;
  sessionId: string;
}

export class SkillUsageService {
  constructor(private readonly db: DatabaseAdapter) {}

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

      await this.safeIncrement({
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
      await this.safeIncrement({
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
    await this.safeIncrement({
      orgId,
      patchDelta: 1,
      patchedAt: now,
      profileId,
      skillId,
    });
  }

  async listForProfile(profileId: string) {
    return this.db.listSkillUsageForProfile(profileId);
  }

  private async safeIncrement(input: {
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
}
