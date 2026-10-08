import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getOrgCuratorLogDir,
  pathExists,
  SKILL_ARCHIVE_DIR_NAME,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
  seedOrgDefaultProfile,
} from "@nakama/db";
import {
  type SkillCuratorGenerateMarkdown,
  SkillCuratorService,
} from "./skill-curator-service";
import { SkillProposalService } from "./skill-proposal-service";
import { SkillsService } from "./skills-service";

const ORG_ID = "org_curator";

const DAY_MS = 24 * 60 * 60 * 1000;

const NOW = new Date("2026-08-15T12:00:00.000Z");

describe("SkillCuratorService", () => {
  let configDir: string;
  let db: DatabaseAdapter;
  let profileId: string;
  let skillsService: SkillsService;
  let curator: SkillCuratorService;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-curator-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    profileId = profile.id;
    skillsService = new SkillsService(db);
    curator = new SkillCuratorService(db, skillsService);
  });

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  });

  async function upsertOrg(input: {
    skillsCuratorConsolidateEnabled?: boolean;
    skillsWriteApproval?: boolean;
  }): Promise<void> {
    await db.upsertOrganization({
      createdAt: NOW.toISOString(),
      id: ORG_ID,
      name: "Curator Org",
      skillsCuratorConsolidateEnabled:
        input.skillsCuratorConsolidateEnabled ?? false,
      skillsWriteApproval: input.skillsWriteApproval ?? false,
      slug: "curator-org",
      updatedAt: NOW.toISOString(),
    });
  }

  async function addAssignedSkill(input: {
    name: string;
    createdBy: "agent" | "human" | "bundled";
    createdAt: string;
    description?: string;
    lastUsedAt?: string | null;
    sourcePath?: string;
    body?: string;
  }): Promise<string> {
    const skillId = `skill_${input.name}`;

    const sourcePath =
      input.sourcePath ??
      join(
        configDir,
        "orgs",
        ORG_ID,
        "profiles",
        profileId,
        "skills",
        input.name
      );

    const description = input.description ?? "Test.";
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      `---\nname: ${input.name}\ndescription: ${description}\n---\n\n${input.body ?? "Keep this.\n"}`
    );
    await db.upsertSkill({
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      description,
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: skillId,
      name: input.name,
      orgId: ORG_ID,
      sourcePath,
      updatedAt: input.createdAt,
    });
    await db.assignSkillToProfile(profileId, skillId);

    if (input.lastUsedAt) {
      await db.incrementSkillUsage({
        orgId: ORG_ID,
        profileId,
        skillId,
        useDelta: 1,
        usedAt: input.lastUsedAt,
      });
    }

    return skillId;
  }

  async function addOverlappingAgentCluster(): Promise<{
    loserId: string;
    loserLiveDir: string;
    winnerId: string;
    winnerLiveDir: string;
    winnerName: string;
  }> {
    const winnerName = "deploy-helper";

    const winnerId = await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      description: "deploy production release checklist helper",
      lastUsedAt: NOW.toISOString(),
      name: winnerName,
    });

    await db.incrementSkillUsage({
      orgId: ORG_ID,
      profileId,
      skillId: winnerId,
      useDelta: 9,
      usedAt: NOW.toISOString(),
    });

    const loserId = await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      description: "deploy production release checklist assistant",
      lastUsedAt: NOW.toISOString(),
      name: "deploy-assistant",
    });

    return {
      loserId,
      loserLiveDir: join(
        configDir,
        "orgs",
        ORG_ID,
        "profiles",
        profileId,
        "skills",
        "deploy-assistant"
      ),
      winnerId,
      winnerLiveDir: join(
        configDir,
        "orgs",
        ORG_ID,
        "profiles",
        profileId,
        "skills",
        winnerName
      ),
      winnerName,
    };
  }

  function stubGenerateMarkdown(
    onCall?: () => void
  ): SkillCuratorGenerateMarkdown {
    return async (input) => {
      onCall?.();

      return `---\nname: ${input.winner.name}\ndescription: Consolidated deploy checklist.\n---\n\nMerged body.\n`;
    };
  }

  test("archives a 95-day unused agent skill and unassigns it", async () => {
    const skillId = await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "old-playbook",
    });

    const liveDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "skills",
      "old-playbook"
    );

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.status).toBe("completed");
    expect(result.archived).toBe(1);
    expect(await pathExists(liveDir)).toBe(false);
    expect(
      await pathExists(
        join(
          configDir,
          "orgs",
          ORG_ID,
          "profiles",
          profileId,
          "skills",
          SKILL_ARCHIVE_DIR_NAME,
          "old-playbook",
          "SKILL.md"
        )
      )
    ).toBe(true);
    expect(await db.listSkillsForProfile(profileId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: skillId })])
    );
    const stored = await db.getSkill(skillId);
    expect(stored?.sourcePath).toContain(
      join(SKILL_ARCHIVE_DIR_NAME, "old-playbook")
    );

    const report = await readFile(
      join(getOrgCuratorLogDir(ORG_ID), "run.json"),
      "utf8"
    );

    expect(JSON.parse(report).archived).toBe(1);
  });

  test("lists a 40-day unused skill as stale without moving it", async () => {
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "human",
      lastUsedAt: new Date(NOW.getTime() - 40 * DAY_MS).toISOString(),
      name: "warming-up",
    });

    const liveDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "skills",
      "warming-up"
    );

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.stale).toBe(1);
    expect(result.archived).toBe(0);
    expect(await pathExists(liveDir)).toBe(true);
  });

  test("does not archive a never-matched skill younger than 30 days", async () => {
    await addAssignedSkill({
      createdAt: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(),
      createdBy: "agent",
      name: "brand-new",
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.skippedTooNew).toBe(1);
    expect(result.archived).toBe(0);
  });

  test("archives a never-matched skill older than 90 days", async () => {
    const skillId = await addAssignedSkill({
      createdAt: new Date(NOW.getTime() - 100 * DAY_MS).toISOString(),
      createdBy: "human",
      name: "forgotten",
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.archived).toBe(1);
    expect(await db.listSkillsForProfile(profileId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: skillId })])
    );
  });

  test("skips bundled skills even when unused for 200 days", async () => {
    const skillId = await addAssignedSkill({
      createdAt: "2025-01-01T00:00:00.000Z",
      createdBy: "bundled",
      lastUsedAt: new Date(NOW.getTime() - 200 * DAY_MS).toISOString(),
      name: "manage-skills",
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.skippedBundled).toBeGreaterThan(0);
    expect(result.archived).toBe(0);
    expect(await db.listSkillsForProfile(profileId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: skillId })])
    );
  });

  test("skips archive when the profile has an enabled automation", async () => {
    const skillId = await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "human",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "cron-playbook",
    });

    await db.upsertAutomation({
      createdAt: NOW.toISOString(),
      definition: {
        prompt: "run",
        steps: [],
        trigger: { type: "manual" },
        version: 1,
      },
      enabled: true,
      id: "auto_1",
      name: "Nightly",
      orgId: ORG_ID,
      profileId,
      updatedAt: NOW.toISOString(),
      version: 1,
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.stale).toBe(1);
    expect(result.skippedAutomation).toBe(1);
    expect(result.archived).toBe(0);
    expect(await db.listSkillsForProfile(profileId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: skillId })])
    );
  });

  test("archives even when skill write approval is on and creates no proposal", async () => {
    await upsertOrg({ skillsWriteApproval: true });
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "gated-playbook",
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.archived).toBe(1);
    expect(await db.listSkillProposals(ORG_ID)).toHaveLength(0);
  });

  test("dry-run reports a would-archive skill without moving it", async () => {
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "preview-me",
    });

    const liveDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "skills",
      "preview-me"
    );

    const result = await curator.run(ORG_ID, {
      dryRun: true,
      now: NOW,
      trigger: "manual",
    });

    expect(result.dryRun).toBe(true);
    expect(result.stale).toBe(1);
    expect(result.archived).toBe(0);
    expect(await pathExists(liveDir)).toBe(true);
  });

  test("restores the directory when unassign fails after rename", async () => {
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "rollback-me",
    });

    const liveDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "skills",
      "rollback-me"
    );

    skillsService.unassignArchivedProfileSkill = async () => {
      throw new Error("db down");
    };

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.archived).toBe(0);
    expect(result.skippedError).toBe(1);
    expect(result.restoreMisses).toEqual([]);
    expect(await pathExists(liveDir)).toBe(true);
  });

  test("records skill id and archived path when restore after unassign failure also fails", async () => {
    const skillId = await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "stuck-playbook",
    });

    const liveDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "skills",
      "stuck-playbook"
    );

    const archivedSkillMd = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "skills",
      SKILL_ARCHIVE_DIR_NAME,
      "stuck-playbook",
      "SKILL.md"
    );

    skillsService.unassignArchivedProfileSkill = async () => {
      await mkdir(liveDir, { recursive: true });
      await writeFile(join(liveDir, "SKILL.md"), "collision\n");
      throw new Error("db down");
    };

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.archived).toBe(0);
    expect(result.skippedError).toBe(1);
    expect(result.restoreMisses).toHaveLength(1);
    expect(result.restoreMisses[0]?.skillId).toBe(skillId);
    expect(result.restoreMisses[0]?.archivedDirectory).toContain(
      join(SKILL_ARCHIVE_DIR_NAME, "stuck-playbook")
    );
    expect(await pathExists(archivedSkillMd)).toBe(true);

    const logDir = getOrgCuratorLogDir(ORG_ID);

    const runJson = JSON.parse(
      await readFile(join(logDir, "run.json"), "utf8")
    );

    expect(runJson.restoreMisses[0].skillId).toBe(skillId);
    const report = await readFile(join(logDir, "REPORT.md"), "utf8");
    expect(report).toContain(skillId);
    expect(report).toContain("stuck-playbook");
  });

  test("overlapping runs for the same org do not double-archive", async () => {
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      lastUsedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
      name: "once-only",
    });
    let release!: () => void;

    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    let entered = 0;

    const original =
      skillsService.unassignArchivedProfileSkill.bind(skillsService);

    skillsService.unassignArchivedProfileSkill = async (...args) => {
      entered += 1;
      await hold;

      return original(...args);
    };

    const first = curator.run(ORG_ID, { now: NOW, trigger: "manual" });
    await bunWaitFor(() => entered === 1);
    const second = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });
    release();
    const firstResult = await first;

    expect(second.status).toBe("in_flight");
    expect(second.archived).toBe(0);
    expect(second.consolidateMerged).toBe(0);
    expect(second.consolidateApplied).toBe(0);
    expect(firstResult.archived).toBe(1);
    expect(entered).toBe(1);
  });

  test("consolidate flag off skips generateMarkdown", async () => {
    await upsertOrg({ skillsCuratorConsolidateEnabled: false });
    await addOverlappingAgentCluster();
    let generateCalls = 0;
    curator = new SkillCuratorService(db, skillsService, undefined, {
      generateMarkdown: stubGenerateMarkdown(() => {
        generateCalls += 1;
      }),
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(generateCalls).toBe(0);
    expect(result.consolidateMerged).toBe(0);
    expect(result.consolidateStaged).toBe(0);
    expect(result.consolidateApplied).toBe(0);
  });

  test("consolidate dry-run lists candidates without calling generateMarkdown", async () => {
    await upsertOrg({ skillsCuratorConsolidateEnabled: true });
    await addOverlappingAgentCluster();
    let generateCalls = 0;
    curator = new SkillCuratorService(db, skillsService, undefined, {
      generateMarkdown: stubGenerateMarkdown(() => {
        generateCalls += 1;
      }),
    });

    const result = await curator.run(ORG_ID, {
      dryRun: true,
      now: NOW,
      trigger: "manual",
    });

    expect(generateCalls).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.consolidateMerged).toBe(1);
    expect(result.consolidateApplied).toBe(0);
    expect(result.consolidateStaged).toBe(0);
    expect(await db.listSkillProposals(ORG_ID)).toHaveLength(0);
  });

  test("consolidate with write approval on stages an edit proposal", async () => {
    await upsertOrg({
      skillsCuratorConsolidateEnabled: true,
      skillsWriteApproval: true,
    });
    const cluster = await addOverlappingAgentCluster();

    const before = await readFile(
      join(cluster.winnerLiveDir, "SKILL.md"),
      "utf8"
    );

    const proposals = new SkillProposalService(db, skillsService);
    curator = new SkillCuratorService(db, skillsService, proposals, {
      generateMarkdown: stubGenerateMarkdown(),
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.consolidateMerged).toBe(1);
    expect(result.consolidateStaged).toBe(1);
    expect(result.consolidateApplied).toBe(0);
    const pending = await db.listSkillProposals(ORG_ID, { status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.action).toBe("edit");
    expect(pending[0]?.skillName).toBe(cluster.winnerName);
    expect(pending[0]?.consolidateLoserSkillNames).toEqual([
      "deploy-assistant",
    ]);
    expect(
      await readFile(join(cluster.winnerLiveDir, "SKILL.md"), "utf8")
    ).toBe(before);
    expect(await pathExists(cluster.loserLiveDir)).toBe(true);
  });

  test("consolidate with write approval off applies edit and archives losers", async () => {
    await upsertOrg({
      skillsCuratorConsolidateEnabled: true,
      skillsWriteApproval: false,
    });
    const cluster = await addOverlappingAgentCluster();
    curator = new SkillCuratorService(db, skillsService, undefined, {
      generateMarkdown: stubGenerateMarkdown(),
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(result.consolidateMerged).toBe(1);
    expect(result.consolidateApplied).toBe(1);
    expect(result.consolidateStaged).toBe(0);
    expect(await db.listSkillProposals(ORG_ID)).toHaveLength(0);

    const winnerMd = await readFile(
      join(cluster.winnerLiveDir, "SKILL.md"),
      "utf8"
    );

    expect(winnerMd).toContain("Merged body.");
    expect(await pathExists(cluster.loserLiveDir)).toBe(false);
    expect(
      await pathExists(
        join(
          configDir,
          "orgs",
          ORG_ID,
          "profiles",
          profileId,
          "skills",
          SKILL_ARCHIVE_DIR_NAME,
          "deploy-assistant",
          "SKILL.md"
        )
      )
    ).toBe(true);
    expect(await db.listSkillsForProfile(profileId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: cluster.loserId })])
    );
    expect(await db.listSkillsForProfile(profileId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: cluster.winnerId }),
      ])
    );
  });

  test("consolidate never merges a bundled skill even when descriptions overlap", async () => {
    await upsertOrg({ skillsCuratorConsolidateEnabled: true });
    const recent = new Date(NOW.getTime() - 2 * DAY_MS).toISOString();
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "bundled",
      description:
        "Deploy helper for production deploy pipeline checklist notes",
      lastUsedAt: recent,
      name: "deploy-helper",
    });
    await addAssignedSkill({
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "agent",
      description:
        "Deploy helper for production deploy pipeline checklist notes",
      lastUsedAt: recent,
      name: "deploy-assistant",
    });
    let generateCalls = 0;
    curator = new SkillCuratorService(db, skillsService, undefined, {
      generateMarkdown: stubGenerateMarkdown(() => {
        generateCalls += 1;
      }),
    });

    const result = await curator.run(ORG_ID, { now: NOW, trigger: "manual" });

    expect(generateCalls).toBe(0);
    expect(result.consolidateMerged).toBe(0);
    expect(result.consolidateApplied).toBe(0);
  });
});

async function bunWaitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for curator lock");
    }

    await Bun.sleep(5);
  }
}
