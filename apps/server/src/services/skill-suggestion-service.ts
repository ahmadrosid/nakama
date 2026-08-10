import {
  detectOrgMemoryInjectionWarnings,
  isGlobalSkillSourcePath,
  isPathWithinProfileSkillsDir,
  NakamaApiError,
  parseRawProfileSkillContent,
  resolveSkillWriteApprovalRequired,
} from "@nakama/core";
import type {
  ApplySkillSuggestionOutcome,
  SkillSuggestion,
} from "@nakama/core/contract";
import {
  assertNotBundledSkillName,
  assertValidSkillName,
} from "@nakama/core/skills/write";
import type {
  DatabaseAdapter,
  SkillSuggestionAction,
  StoredSkillSuggestion,
} from "@nakama/db";
import type { SkillProposalService } from "./skill-proposal-service";
import type { SkillsService } from "./skills-service";

export function toSkillSuggestion(
  record: StoredSkillSuggestion
): SkillSuggestion {
  const { warnings, ...suggestion } = record;
  return warnings?.length ? { ...suggestion, warnings } : suggestion;
}

export type SkillSuggestionOutcome =
  | { action: "create"; name: string; content: string }
  | { action: "patch"; name: string; oldString: string; newString: string };

export interface CreateSkillSuggestionInput {
  orgId: string;
  outcome: SkillSuggestionOutcome;
  profileId: string;
  proposedByUserId?: string | null;
  sessionId?: string | null;
}

export interface ApplySkillSuggestionResult {
  outcome: ApplySkillSuggestionOutcome;
  proposalId?: string;
  suggestion: StoredSkillSuggestion;
}

export class SkillSuggestionService {
  constructor(
    private readonly database: DatabaseAdapter | null = null,
    private readonly skillsService: SkillsService | null = null,
    private readonly skillProposalService: SkillProposalService | null = null
  ) {}

  async isWriteApprovalRequired(
    orgId: string,
    profileId: string
  ): Promise<boolean> {
    const db = this.requireDatabase();
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw new NakamaApiError("Organization not found.", 404);
    }
    const profile = await db.getProfileForOrg(profileId, orgId);
    if (!profile) {
      throw new NakamaApiError("Profile not found.", 404);
    }
    return resolveSkillWriteApprovalRequired({
      orgSkillsWriteApproval: org.skillsWriteApproval ?? false,
      profileSkillsWriteApproval: profile.skillsWriteApproval ?? null,
    });
  }

  async createSuggestion(
    input: CreateSkillSuggestionInput
  ): Promise<StoredSkillSuggestion> {
    const db = this.requireDatabase();
    const { outcome } = input;
    const name = assertValidSkillName(outcome.name);
    assertNotBundledSkillName(name);

    const now = new Date().toISOString();
    const record: StoredSkillSuggestion = {
      action: outcome.action,
      appliedAt: null,
      content: outcome.action === "create" ? outcome.content : null,
      createdAt: now,
      id: `sksug_${crypto.randomUUID().replace(/-/g, "")}`,
      orgId: input.orgId,
      patchNewString: outcome.action === "patch" ? outcome.newString : null,
      patchOldString: outcome.action === "patch" ? outcome.oldString : null,
      profileId: input.profileId,
      proposedByUserId: input.proposedByUserId ?? null,
      sessionId: input.sessionId ?? null,
      skillName: name,
      source: "post_turn_review",
      status: "pending",
      warnings: this.computeWarnings(outcome) ?? null,
    };

    await db.createSkillSuggestion(record);
    return record;
  }

  async listSuggestions(
    orgId: string,
    options: {
      sessionId?: string;
      status?: StoredSkillSuggestion["status"];
      profileId?: string;
    } = {}
  ): Promise<StoredSkillSuggestion[]> {
    return this.requireDatabase().listSkillSuggestions(orgId, options);
  }

  async getSuggestion(
    orgId: string,
    id: string
  ): Promise<StoredSkillSuggestion> {
    const suggestion = await this.requireDatabase().getSkillSuggestion(
      orgId,
      id
    );
    if (!suggestion) {
      throw new NakamaApiError("Skill suggestion not found.", 404);
    }
    return suggestion;
  }

  /**
   * Commits a pending suggestion. Re-checks org/profile write-approval at apply
   * time (not creation time) since the gate can flip between suggestion and
   * apply — if it is now on, the suggestion is converted into a pending
   * proposal instead of writing directly.
   */
  async applySuggestion(
    orgId: string,
    id: string,
    actorUserId: string
  ): Promise<ApplySkillSuggestionResult> {
    const db = this.requireDatabase();
    const suggestion = await this.getSuggestion(orgId, id);

    if (suggestion.status === "applied") {
      return { outcome: "already_applied", suggestion };
    }

    assertNotBundledSkillName(suggestion.skillName);

    const writeApprovalRequired = await this.isWriteApprovalRequired(
      orgId,
      suggestion.profileId
    );

    if (writeApprovalRequired) {
      const proposals = this.requireProposalService();
      const staged = await proposals.stageProposal({
        action: suggestion.action,
        content: suggestion.content ?? undefined,
        newString: suggestion.patchNewString ?? undefined,
        oldString: suggestion.patchOldString ?? undefined,
        orgId,
        profileId: suggestion.profileId,
        proposedByUserId: actorUserId,
        sessionId: suggestion.sessionId,
        skillName: suggestion.skillName,
      });

      const appliedAt = new Date().toISOString();
      await db.markSkillSuggestionApplied(orgId, id, appliedAt);

      return {
        outcome: "staged_as_proposal",
        proposalId: staged.proposalId,
        suggestion: { ...suggestion, appliedAt, status: "applied" },
      };
    }

    const skills = this.requireSkillsService();
    if (suggestion.action === "create") {
      const content = suggestion.content;
      if (!content?.trim()) {
        throw new NakamaApiError("Suggestion is missing content.", 400);
      }
      parseRawProfileSkillContent(content, orgId, suggestion.profileId);
      await skills.createAndAssignRawSkillToProfile(
        orgId,
        suggestion.profileId,
        content
      );
    } else {
      const oldString = suggestion.patchOldString;
      const newString = suggestion.patchNewString;
      if (oldString === null || oldString === "" || newString === null) {
        throw new NakamaApiError("Suggestion is missing patch fields.", 400);
      }
      await this.assertProfileOwnedSkill(
        orgId,
        suggestion.profileId,
        suggestion.skillName
      );
      await skills.patchAssignedProfileSkill(
        orgId,
        suggestion.profileId,
        suggestion.skillName,
        oldString,
        newString
      );
    }

    const appliedAt = new Date().toISOString();
    await db.markSkillSuggestionApplied(orgId, id, appliedAt);

    return {
      outcome: "applied",
      suggestion: { ...suggestion, appliedAt, status: "applied" },
    };
  }

  private async assertProfileOwnedSkill(
    orgId: string,
    profileId: string,
    name: string
  ): Promise<void> {
    const db = this.requireDatabase();
    const skillName = assertValidSkillName(name);
    const record = await db.getSkillByName(skillName);
    if (!record) {
      throw new NakamaApiError(`Skill "${skillName}" not found.`, 404);
    }
    if (isGlobalSkillSourcePath(record.sourcePath)) {
      throw new NakamaApiError(
        "Global skills cannot be modified by agents.",
        403
      );
    }
    if (!isPathWithinProfileSkillsDir(orgId, profileId, record.sourcePath)) {
      throw new NakamaApiError(
        `Skill "${skillName}" is not owned by this profile.`,
        403
      );
    }
  }

  private computeWarnings(
    outcome: SkillSuggestionOutcome
  ): string[] | undefined {
    const warnings =
      outcome.action === "create"
        ? detectOrgMemoryInjectionWarnings(outcome.content)
        : [
            ...detectOrgMemoryInjectionWarnings(outcome.oldString),
            ...detectOrgMemoryInjectionWarnings(outcome.newString),
          ];
    const unique = [...new Set(warnings)];
    return unique.length > 0 ? unique : undefined;
  }

  private requireDatabase(): DatabaseAdapter {
    if (!this.database) {
      throw new NakamaApiError("Database not configured.", 500);
    }
    return this.database;
  }

  private requireSkillsService(): SkillsService {
    if (!this.skillsService) {
      throw new NakamaApiError("Skills service not configured.", 500);
    }
    return this.skillsService;
  }

  private requireProposalService(): SkillProposalService {
    if (!this.skillProposalService) {
      throw new NakamaApiError("Skill proposal service not configured.", 500);
    }
    return this.skillProposalService;
  }
}

export type { SkillSuggestionAction };
