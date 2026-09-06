import { join } from "node:path";
import type {
  SkillConsolidateBodyInput,
  SkillConsolidateMode,
} from "@nakama/agent";
import {
  archiveSkillDirectory,
  BUNDLED_SKILL_NAMES,
  buildConsolidatePlan,
  type ConsolidateCandidateSkill,
  classifySkillFreshness,
  getOrgCuratorLogDir,
  isGlobalSkillSourcePath,
  pathExists,
  readTextIfExists,
  resolveProfileOrgBooleanOverride,
  restoreArchivedSkillDirectory,
  writeTextFile,
} from "@nakama/core";
import type {
  SkillCuratorRestoreMiss,
  SkillCuratorRunResult,
  SkillCuratorTrigger,
} from "@nakama/core/contract";
import type { DatabaseAdapter, StoredSkillRecord } from "@nakama/db";
import type { SkillProposalService } from "./skill-proposal-service";
import type { SkillsService } from "./skills-service";

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

export type { SkillCuratorRunResult, SkillCuratorTrigger };

export interface SkillCuratorRunOptions {
  dryRun?: boolean;
  now?: Date;
  trigger: SkillCuratorTrigger;
}

export type SkillCuratorGenerateMarkdown = (input: {
  losers?: SkillConsolidateBodyInput[];
  mode: SkillConsolidateMode;
  profileId: string;
  winner: SkillConsolidateBodyInput;
}) => Promise<string | null>;

export interface SkillCuratorServiceOptions {
  generateMarkdown?: SkillCuratorGenerateMarkdown;
}

const emptyCounts = {
  archived: 0,
  consolidateApplied: 0,
  consolidateBudgetExhausted: false,
  consolidateDeslopified: 0,
  consolidateMerged: 0,
  consolidateSkipped: 0,
  consolidateStaged: 0,
  scanned: 0,
  skippedAutomation: 0,
  skippedBundled: 0,
  skippedError: 0,
  skippedTooNew: 0,
  stale: 0,
};

type CuratorCounts = typeof emptyCounts & {
  restoreMisses: SkillCuratorRestoreMiss[];
};

export class SkillCuratorService {
  private readonly generateMarkdown: SkillCuratorGenerateMarkdown;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly skillsService: SkillsService,
    private readonly skillProposalService?: SkillProposalService,
    options?: SkillCuratorServiceOptions
  ) {
    this.generateMarkdown =
      options?.generateMarkdown ??
      // Wired from index.ts with resolveProfileProviderSelection + createProviderForInstance.
      (async () => null);
  }

  async run(
    orgId: string,
    options: SkillCuratorRunOptions
  ): Promise<SkillCuratorRunResult> {
    const startedAt = (options.now ?? new Date()).toISOString();
    const dryRun = options.dryRun === true || options.trigger === "seed";

    if (this.inFlight.has(orgId)) {
      return {
        ...emptyCounts,
        dryRun,
        finishedAt: startedAt,
        orgId,
        restoreMisses: [],
        startedAt,
        status: "in_flight",
        trigger: options.trigger,
      };
    }

    this.inFlight.add(orgId);

    try {
      const result = await this.runLocked(orgId, {
        ...options,
        dryRun,
        startedAt,
      });
      await this.writeReports(orgId, result);
      return result;
    } finally {
      this.inFlight.delete(orgId);
    }
  }

  async readLatest(orgId: string): Promise<SkillCuratorRunResult | null> {
    const raw = await readTextIfExists(
      join(getOrgCuratorLogDir(orgId), "run.json")
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SkillCuratorRunResult;
    if (parsed.orgId !== orgId) {
      return null;
    }

    return {
      ...parsed,
      restoreMisses: parsed.restoreMisses ?? [],
    };
  }

  private async runLocked(
    orgId: string,
    options: SkillCuratorRunOptions & { dryRun: boolean; startedAt: string }
  ): Promise<SkillCuratorRunResult> {
    const now = options.now ?? new Date();
    const counts: CuratorCounts = {
      ...emptyCounts,
      restoreMisses: [],
    };
    const org = await this.db.getOrganizationById(orgId);
    const staleAfterDays = org?.skillsCuratorStaleAfterDays ?? 30;
    const archiveAfterDays = org?.skillsCuratorArchiveAfterDays ?? 90;
    const profiles = await this.db.listProfilesForOrg(orgId);
    for (const profile of profiles) {
      if (profile.orgId !== orgId) {
        throw new Error("Curator profile must belong to the requested org.");
      }
    }
    const enabledAutomationProfileIds = new Set(
      (await this.db.listAutomationsForOrg(orgId))
        .filter((automation) => automation.enabled)
        .map((automation) => automation.profileId)
    );

    for (const profile of profiles) {
      const assigned = await this.db.listSkillsForProfile(profile.id);
      const usageBySkillId = new Map(
        (await this.db.listSkillUsageForProfile(profile.id)).map((row) => [
          row.skillId,
          row,
        ])
      );

      for (const skill of assigned) {
        counts.scanned += 1;

        if (isExemptFromCurator(skill)) {
          counts.skippedBundled += 1;
          continue;
        }

        const usage = usageBySkillId.get(skill.id);
        const freshness = classifySkillFreshness({
          archiveAfterDays,
          createdAt: skill.createdAt,
          lastUsedAt: usage?.lastUsedAt,
          now,
          staleAfterDays,
        });

        if (freshness === "active") {
          counts.skippedTooNew += 1;
          continue;
        }

        counts.stale += 1;

        if (freshness !== "archive_due") {
          continue;
        }

        if (enabledAutomationProfileIds.has(profile.id)) {
          counts.skippedAutomation += 1;
          continue;
        }

        if (options.dryRun) {
          continue;
        }

        const outcome = await this.archiveAssignedSkill({
          now,
          orgId,
          profileId: profile.id,
          skill,
        });

        if (outcome.archived) {
          counts.archived += 1;
        } else {
          counts.skippedError += 1;
          if (outcome.restoreMiss) {
            counts.restoreMisses.push(outcome.restoreMiss);
          }
        }
      }
    }

    await this.runConsolidatePhase({
      counts,
      dryRun: options.dryRun,
      enabledAutomationProfileIds,
      now,
      orgId,
      profiles,
    });

    return {
      ...counts,
      dryRun: options.dryRun,
      finishedAt: new Date().toISOString(),
      orgId,
      startedAt: options.startedAt,
      status: "completed",
      trigger: options.trigger,
    };
  }

  private async runConsolidatePhase(input: {
    counts: CuratorCounts;
    dryRun: boolean;
    enabledAutomationProfileIds: Set<string>;
    now: Date;
    orgId: string;
    profiles: Awaited<ReturnType<DatabaseAdapter["listProfilesForOrg"]>>;
  }): Promise<void> {
    const org = await this.db.getOrganizationById(input.orgId);

    for (const profile of input.profiles) {
      const consolidateEnabled = resolveProfileOrgBooleanOverride(
        profile.skillsCuratorConsolidateEnabled ?? null,
        org?.skillsCuratorConsolidateEnabled ?? false
      );
      if (!consolidateEnabled) {
        continue;
      }

      const assigned = await this.db.listSkillsForProfile(profile.id);
      const usageBySkillId = new Map(
        (await this.db.listSkillUsageForProfile(profile.id)).map((row) => [
          row.skillId,
          row,
        ])
      );
      const pending = await this.db.listSkillProposals(input.orgId, {
        profileId: profile.id,
        status: "pending",
      });
      const pendingSkillNames = new Set(
        pending.map((proposal) => proposal.skillName)
      );

      const candidates: ConsolidateCandidateSkill[] = [];

      for (const skill of assigned) {
        const body =
          (await readTextIfExists(join(skill.sourcePath, "SKILL.md"))) ?? "";
        const usage = usageBySkillId.get(skill.id);
        candidates.push({
          body,
          createdBy: skill.createdBy,
          description: skill.description,
          id: skill.id,
          lastPatchedAt: usage?.lastPatchedAt,
          lastUsedAt: usage?.lastUsedAt,
          name: skill.name,
          sourcePath: skill.sourcePath,
          useCount: usage?.useCount,
        });
      }

      const plan = buildConsolidatePlan({
        hasEnabledAutomation: input.enabledAutomationProfileIds.has(profile.id),
        now: input.now,
        pendingSkillNames,
        skills: candidates,
      });

      input.counts.consolidateSkipped += plan.skippedCount;
      if (plan.budgetExhausted) {
        input.counts.consolidateBudgetExhausted = true;
      }

      if (input.dryRun) {
        input.counts.consolidateMerged += plan.clusters.length;
        input.counts.consolidateDeslopified += plan.solos.length;
        continue;
      }

      for (const cluster of plan.clusters) {
        const outcome = await this.applyConsolidateUnit({
          losers: cluster.losers,
          mode: "merge",
          now: input.now,
          orgId: input.orgId,
          profileId: profile.id,
          winner: cluster.winner,
        });
        this.recordConsolidateOutcome(input.counts, "merge", outcome);
      }

      for (const solo of plan.solos) {
        const outcome = await this.applyConsolidateUnit({
          losers: [],
          mode: "deslopify",
          now: input.now,
          orgId: input.orgId,
          profileId: profile.id,
          winner: solo,
        });
        this.recordConsolidateOutcome(input.counts, "deslopify", outcome);
      }
    }
  }

  private recordConsolidateOutcome(
    counts: CuratorCounts,
    mode: SkillConsolidateMode,
    outcome: "staged" | "applied" | "skipped"
  ): void {
    if (outcome === "skipped") {
      counts.consolidateSkipped += 1;
      return;
    }
    if (mode === "merge") {
      counts.consolidateMerged += 1;
    } else {
      counts.consolidateDeslopified += 1;
    }
    if (outcome === "staged") {
      counts.consolidateStaged += 1;
    } else {
      counts.consolidateApplied += 1;
    }
  }

  private async applyConsolidateUnit(input: {
    losers: ConsolidateCandidateSkill[];
    mode: SkillConsolidateMode;
    now: Date;
    orgId: string;
    profileId: string;
    winner: ConsolidateCandidateSkill;
  }): Promise<"staged" | "applied" | "skipped"> {
    const hasLosers = input.losers.length > 0;
    if ((input.mode === "merge") !== hasLosers) {
      throw new Error("Merge requires losers; deslopify requires none.");
    }

    const winnerBody: SkillConsolidateBodyInput = {
      body: input.winner.body,
      description: input.winner.description,
      name: input.winner.name,
    };

    const loserBodies = input.losers.map((loser) => ({
      body: loser.body,
      description: loser.description,
      name: loser.name,
    }));

    let markdown: string | null;
    try {
      markdown = await this.generateMarkdown({
        losers: loserBodies.length > 0 ? loserBodies : undefined,
        mode: input.mode,
        profileId: input.profileId,
        winner: winnerBody,
      });
    } catch {
      return "skipped";
    }

    if (!markdown?.trim()) {
      return "skipped";
    }

    const loserNames = input.losers.map((loser) => loser.name);
    const proposals = this.skillProposalService;
    const writeApprovalRequired = proposals
      ? await proposals.isWriteApprovalRequired(input.orgId, input.profileId)
      : false;

    if (writeApprovalRequired && proposals) {
      try {
        const staged = await proposals.stageProposal({
          action: "edit",
          consolidateLoserSkillNames: loserNames,
          content: markdown,
          orgId: input.orgId,
          profileId: input.profileId,
          skillName: input.winner.name,
        });
        return staged.outcome === "created" ? "staged" : "skipped";
      } catch {
        return "skipped";
      }
    }

    try {
      await this.skillsService.editAssignedProfileSkill(
        input.orgId,
        input.profileId,
        input.winner.name,
        markdown
      );

      for (const loserSkill of input.losers) {
        const outcome = await this.archiveAssignedSkill({
          now: input.now,
          orgId: input.orgId,
          profileId: input.profileId,
          skill: loserSkill,
        });
        if (!outcome.archived) {
          return "skipped";
        }
      }

      return "applied";
    } catch {
      return "skipped";
    }
  }

  private async archiveAssignedSkill(input: {
    orgId: string;
    profileId: string;
    skill: Pick<StoredSkillRecord, "id" | "name">;
    now: Date;
  }): Promise<
    | { archived: true }
    | { archived: false; restoreMiss?: SkillCuratorRestoreMiss }
  > {
    let archivedDirectory: string | null = null;

    try {
      const archived = await archiveSkillDirectory({
        now: input.now,
        orgId: input.orgId,
        profileId: input.profileId,
        skillName: input.skill.name,
      });
      archivedDirectory = archived.archivedDirectory;
      await this.skillsService.unassignArchivedProfileSkill(
        input.orgId,
        input.profileId,
        input.skill.id,
        archived.archivedDirectory
      );
      return { archived: true };
    } catch {
      if (archivedDirectory && (await pathExists(archivedDirectory))) {
        try {
          await restoreArchivedSkillDirectory({
            archivedDirectory,
            orgId: input.orgId,
            profileId: input.profileId,
            skillName: input.skill.name,
          });
        } catch {
          return {
            archived: false,
            restoreMiss: {
              archivedDirectory,
              skillId: input.skill.id,
            },
          };
        }
      }

      return { archived: false };
    }
  }

  private async writeReports(
    orgId: string,
    result: SkillCuratorRunResult
  ): Promise<void> {
    const logDir = getOrgCuratorLogDir(orgId);
    await writeTextFile(
      join(logDir, "run.json"),
      `${JSON.stringify(result, null, 2)}\n`
    );
    await writeTextFile(join(logDir, "REPORT.md"), formatCuratorReport(result));
  }
}

function isExemptFromCurator(skill: StoredSkillRecord): boolean {
  return (
    skill.createdBy === "bundled" ||
    bundledSkillNames.has(skill.name) ||
    isGlobalSkillSourcePath(skill.sourcePath)
  );
}

function formatCuratorReport(result: SkillCuratorRunResult): string {
  const lines = [
    "# Skill curator",
    "",
    `- org: ${result.orgId}`,
    `- trigger: ${result.trigger}`,
    `- dryRun: ${result.dryRun}`,
    `- scanned: ${result.scanned}`,
    `- stale: ${result.stale}`,
    `- archived: ${result.archived}`,
    `- skippedBundled: ${result.skippedBundled}`,
    `- skippedAutomation: ${result.skippedAutomation}`,
    `- skippedTooNew: ${result.skippedTooNew}`,
    `- skippedError: ${result.skippedError}`,
    `- restoreMisses: ${result.restoreMisses.length}`,
    `- consolidateMerged: ${result.consolidateMerged ?? 0}`,
    `- consolidateDeslopified: ${result.consolidateDeslopified ?? 0}`,
    `- consolidateStaged: ${result.consolidateStaged ?? 0}`,
    `- consolidateApplied: ${result.consolidateApplied ?? 0}`,
    `- consolidateSkipped: ${result.consolidateSkipped ?? 0}`,
    `- consolidateBudgetExhausted: ${result.consolidateBudgetExhausted === true}`,
  ];

  if (result.restoreMisses.length > 0) {
    lines.push(
      "",
      "Restore misses (folder stayed in .archive; catalog row still points at the live path):"
    );
    for (const miss of result.restoreMisses) {
      lines.push(`- ${miss.skillId} ${miss.archivedDirectory}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
