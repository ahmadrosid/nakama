import {
  archiveSkillDirectory,
  detectOrgMemoryInjectionWarnings,
  isGlobalSkillSourcePath,
  isPathWithinProfileSkillsDir,
  NakamaApiError,
  parseRawProfileSkillContent,
  resolveProfileOrgBooleanOverride,
  resolveProfileSkillSupportingFilePath,
} from "@nakama/core";
import type { SkillProposal } from "@nakama/core/contract";
import {
  assertNotBundledSkillName,
  assertValidSkillName,
} from "@nakama/core/skills/write";
import type {
  DatabaseAdapter,
  SkillProposalAction,
  StoredSkillProposal,
} from "@nakama/db";
import type { SkillsService } from "./skills-service";

export function toSkillProposal(
  record: StoredSkillProposal & { warnings?: string[] }
): SkillProposal {
  const { warnings, ...proposal } = record;
  return warnings?.length ? { ...proposal, warnings } : proposal;
}

export const MAX_SKILL_PATCH_FIELD_LENGTH = 500;
export const MAX_SKILL_PROPOSAL_CONTENT_BYTES = 64 * 1024;

export type StageSkillProposalOutcome = "created" | "already_pending";

export interface StageSkillProposalInput {
  action: SkillProposalAction;
  consolidateLoserSkillNames?: string[];
  content?: string;
  newString?: string;
  oldString?: string;
  orgId: string;
  profileId: string;
  proposedByUserId?: string | null;
  relativePath?: string;
  sessionId?: string | null;
  skillName?: string;
}

export interface StageSkillProposalResult {
  message: string;
  outcome: StageSkillProposalOutcome;
  proposalId?: string;
  /** Present for supporting-file proposals (including already_pending echoes). */
  relativePath?: string;
  warnings?: string[];
}

export async function isSkillWriteApprovalRequired(
  database: DatabaseAdapter,
  orgId: string,
  profileId: string
): Promise<boolean> {
  const org = await database.getOrganizationById(orgId);
  if (!org) {
    throw new NakamaApiError("Organization not found.", 404);
  }
  const profile = await database.getProfileForOrg(profileId, orgId);
  if (!profile) {
    throw new NakamaApiError("Profile not found.", 404);
  }
  return resolveProfileOrgBooleanOverride(
    profile.skillsWriteApproval ?? null,
    org.skillsWriteApproval ?? false
  );
}

export class SkillProposalService {
  constructor(
    private readonly database: DatabaseAdapter | null = null,
    private readonly skillsService: SkillsService | null = null
  ) {}

  async isWriteApprovalRequired(
    orgId: string,
    profileId: string
  ): Promise<boolean> {
    return isSkillWriteApprovalRequired(
      this.requireDatabase(),
      orgId,
      profileId
    );
  }

  async stageProposal(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const db = this.requireDatabase();
    const profile = await db.getProfileForOrg(input.profileId, input.orgId);
    if (!profile) {
      throw new NakamaApiError("Profile not found.", 404);
    }

    if (input.action === "create") {
      return this.stageCreate(input);
    }
    if (input.action === "patch") {
      return this.stagePatch(input);
    }
    if (input.action === "edit") {
      return this.stageEdit(input);
    }
    if (input.action === "write_file") {
      return this.stageWriteFile(input);
    }
    if (input.action === "remove_file") {
      return this.stageRemoveFile(input);
    }
    return this.stageDelete(input);
  }

  async listProposals(
    orgId: string,
    options: {
      status?: StoredSkillProposal["status"];
      profileId?: string;
      sessionId?: string;
    } = {}
  ): Promise<{ proposals: StoredSkillProposal[]; pendingCount: number }> {
    const db = this.requireDatabase();
    const proposals = await db.listSkillProposals(orgId, options);
    const pendingCount = options.sessionId
      ? proposals.filter((proposal) => proposal.status === "pending").length
      : await db.countPendingSkillProposals(orgId, options.profileId);
    return {
      pendingCount,
      proposals: proposals.map((proposal) => this.withWarnings(proposal)),
    };
  }

  async approveProposal(
    orgId: string,
    proposalId: string,
    reviewerUserId: string
  ): Promise<StoredSkillProposal> {
    const db = this.requireDatabase();
    const skills = this.requireSkillsService();
    const proposal = await this.getProposal(orgId, proposalId);

    if (proposal.status === "approved") {
      return proposal;
    }
    if (proposal.status !== "pending") {
      throw new NakamaApiError("Only pending proposals can be approved.", 400);
    }

    const changeMeta = {
      actorUserId: reviewerUserId,
      source: "skill_manage" as const,
    };

    if (proposal.action === "create") {
      const content = proposal.content;
      if (!content?.trim()) {
        throw new NakamaApiError("Create proposal is missing content.", 400);
      }
      parseRawProfileSkillContent(content, orgId, proposal.profileId);
      await skills.createAndAssignRawSkillToProfile(
        orgId,
        proposal.profileId,
        content,
        { changeMeta }
      );
    } else if (proposal.action === "patch") {
      const oldString = proposal.patchOldString;
      const newString = proposal.patchNewString;
      if (oldString === null || oldString === "" || newString === null) {
        throw new NakamaApiError(
          "Patch proposal is missing patch fields.",
          400
        );
      }
      await skills.patchAssignedProfileSkill(
        orgId,
        proposal.profileId,
        proposal.skillName,
        oldString,
        newString,
        changeMeta
      );
    } else if (proposal.action === "edit") {
      const content = proposal.content;
      if (!content?.trim()) {
        throw new NakamaApiError("Edit proposal is missing content.", 400);
      }
      await skills.editAssignedProfileSkill(
        orgId,
        proposal.profileId,
        proposal.skillName,
        content,
        changeMeta
      );
      await this.archiveConsolidateLosers(orgId, proposal);
    } else if (proposal.action === "write_file") {
      const content = proposal.content;
      const relativePath = proposal.relativePath;
      if (content === null || !relativePath?.trim()) {
        throw new NakamaApiError(
          "Write-file proposal is missing path or content.",
          400
        );
      }
      await skills.writeAssignedProfileSkillSupportingFile(
        orgId,
        proposal.profileId,
        proposal.skillName,
        relativePath,
        content
      );
    } else if (proposal.action === "remove_file") {
      const relativePath = proposal.relativePath;
      if (!relativePath?.trim()) {
        throw new NakamaApiError("Remove-file proposal is missing path.", 400);
      }
      await skills.removeAssignedProfileSkillSupportingFile(
        orgId,
        proposal.profileId,
        proposal.skillName,
        relativePath
      );
    } else {
      await skills.deleteAssignedProfileSkill(
        orgId,
        proposal.profileId,
        proposal.skillName,
        changeMeta
      );
    }

    const reviewedAt = new Date().toISOString();
    await db.updateSkillProposalStatus(orgId, proposalId, {
      reviewedAt,
      reviewerUserId,
      status: "approved",
    });

    return {
      ...proposal,
      reviewedAt,
      reviewerUserId,
      status: "approved",
    };
  }

  async rejectProposal(
    orgId: string,
    proposalId: string,
    reviewerUserId: string
  ): Promise<StoredSkillProposal> {
    const db = this.requireDatabase();
    const proposal = await this.getProposal(orgId, proposalId);

    if (proposal.status === "rejected") {
      return proposal;
    }
    if (proposal.status !== "pending") {
      throw new NakamaApiError("Only pending proposals can be rejected.", 400);
    }

    const reviewedAt = new Date().toISOString();
    await db.updateSkillProposalStatus(orgId, proposalId, {
      reviewedAt,
      reviewerUserId,
      status: "rejected",
    });

    return {
      ...proposal,
      reviewedAt,
      reviewerUserId,
      status: "rejected",
    };
  }

  async countPending(orgId: string, profileId?: string): Promise<number> {
    return this.requireDatabase().countPendingSkillProposals(orgId, profileId);
  }

  private async stageCreate(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const content = input.content;
    if (!content?.trim()) {
      throw new NakamaApiError("content is required for create.", 400);
    }
    this.assertContentSize(content);

    const { name } = parseRawProfileSkillContent(
      content,
      input.orgId,
      input.profileId
    );

    const db = this.requireDatabase();
    const existingByName = await db.getSkillByName(name, input.orgId);
    if (
      existingByName &&
      !isPathWithinProfileSkillsDir(
        input.orgId,
        input.profileId,
        existingByName.sourcePath
      )
    ) {
      throw new NakamaApiError(
        `Skill "${name}" already exists globally or in another profile and cannot be created here.`,
        400
      );
    }

    const pending = await db.getPendingSkillProposalForSkill(
      input.orgId,
      input.profileId,
      name
    );
    if (pending) {
      return {
        message: `A pending proposal already exists for skill "${name}".`,
        outcome: "already_pending",
        proposalId: pending.id,
        warnings: this.warningsForContent(content),
      };
    }

    const proposal = await this.insertProposal({
      ...input,
      action: "create",
      content,
      patchNewString: null,
      patchOldString: null,
      relativePath: null,
      skillName: name,
    });

    return {
      message: `Staged create for skill "${name}" (proposal ${proposal.id}). An org admin must approve before it goes live.`,
      outcome: "created",
      proposalId: proposal.id,
      warnings: this.warningsForContent(content),
    };
  }

  private async stagePatch(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const name = this.readSkillName(input);
    assertNotBundledSkillName(name);
    await this.assertProfileOwnedSkill(input.orgId, input.profileId, name);

    const oldString = input.oldString;
    const newString = input.newString;
    if (oldString === undefined || oldString === "") {
      throw new NakamaApiError("old_string is required for patch.", 400);
    }
    if (newString === undefined) {
      throw new NakamaApiError("new_string is required for patch.", 400);
    }
    this.assertPatchFieldSize(oldString);
    this.assertPatchFieldSize(newString);

    const db = this.requireDatabase();
    const pending = await db.getPendingSkillProposalForPatch(
      input.orgId,
      input.profileId,
      name,
      oldString,
      newString
    );
    if (pending) {
      return {
        message: `An identical patch proposal for "${name}" is already pending.`,
        outcome: "already_pending",
        proposalId: pending.id,
      };
    }

    const conflicting = await db.getPendingSkillProposalForSkill(
      input.orgId,
      input.profileId,
      name
    );
    if (conflicting) {
      return {
        message: `A pending proposal already exists for skill "${name}".`,
        outcome: "already_pending",
        proposalId: conflicting.id,
      };
    }

    const proposal = await this.insertProposal({
      ...input,
      action: "patch",
      content: null,
      patchNewString: newString,
      patchOldString: oldString,
      relativePath: null,
      skillName: name,
    });

    return {
      message: `Staged patch for skill "${name}" (proposal ${proposal.id}). An org admin must approve before it goes live.`,
      outcome: "created",
      proposalId: proposal.id,
      warnings: this.warningsForPatch(oldString, newString),
    };
  }

  private async stageDelete(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const name = this.readSkillName(input);
    assertNotBundledSkillName(name);
    await this.assertProfileOwnedSkill(input.orgId, input.profileId, name);

    const db = this.requireDatabase();
    const pending = await db.getPendingSkillProposalForSkill(
      input.orgId,
      input.profileId,
      name
    );
    if (pending) {
      return {
        message: `A pending proposal already exists for skill "${name}".`,
        outcome: "already_pending",
        proposalId: pending.id,
      };
    }

    const proposal = await this.insertProposal({
      ...input,
      action: "delete",
      content: null,
      patchNewString: null,
      patchOldString: null,
      relativePath: null,
      skillName: name,
    });

    return {
      message: `Staged delete for skill "${name}" (proposal ${proposal.id}). An org admin must approve before it is removed.`,
      outcome: "created",
      proposalId: proposal.id,
    };
  }

  private async stageEdit(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const name = this.readSkillName(input);
    assertNotBundledSkillName(name);
    await this.assertProfileOwnedSkill(input.orgId, input.profileId, name);

    const content = input.content;
    if (!content?.trim()) {
      throw new NakamaApiError("content is required for edit.", 400);
    }
    this.assertContentSize(content);

    const { name: parsedName } = parseRawProfileSkillContent(
      content,
      input.orgId,
      input.profileId
    );
    if (parsedName !== name) {
      throw new NakamaApiError(
        `Frontmatter name "${parsedName}" must match skill name "${name}".`,
        400
      );
    }

    const pending = await this.pendingForSkillOrAlready(input, name, content);
    if (pending) {
      return pending;
    }

    const proposal = await this.insertProposal({
      ...input,
      action: "edit",
      consolidateLoserSkillNames: input.consolidateLoserSkillNames ?? null,
      content,
      patchNewString: null,
      patchOldString: null,
      relativePath: null,
      skillName: name,
    });

    return {
      message: `Staged edit for skill "${name}" (proposal ${proposal.id}). An org admin must approve before it goes live.`,
      outcome: "created",
      proposalId: proposal.id,
      warnings: this.warningsForContent(content),
    };
  }

  private async stageWriteFile(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const name = this.readSkillName(input);
    assertNotBundledSkillName(name);
    await this.assertProfileOwnedSkill(input.orgId, input.profileId, name);

    const relativePath = input.relativePath?.trim();
    if (!relativePath) {
      throw new NakamaApiError("path is required for write_file.", 400);
    }
    const content = input.content;
    if (content === undefined) {
      throw new NakamaApiError("content is required for write_file.", 400);
    }
    this.assertContentSize(content);

    // Validate path containment / basename before staging.
    resolveProfileSkillSupportingFilePath(
      input.orgId,
      input.profileId,
      name,
      relativePath
    );

    const pending = await this.pendingForSkillOrAlready(input, name);
    if (pending) {
      return pending;
    }

    const proposal = await this.insertProposal({
      ...input,
      action: "write_file",
      content,
      patchNewString: null,
      patchOldString: null,
      relativePath,
      skillName: name,
    });

    return {
      message: `Staged write_file for skill "${name}" path "${relativePath}" (proposal ${proposal.id}). An org admin must approve before it goes live.`,
      outcome: "created",
      proposalId: proposal.id,
      relativePath,
      warnings: this.warningsForContent(content),
    };
  }

  private async stageRemoveFile(
    input: StageSkillProposalInput
  ): Promise<StageSkillProposalResult> {
    const name = this.readSkillName(input);
    assertNotBundledSkillName(name);
    await this.assertProfileOwnedSkill(input.orgId, input.profileId, name);

    const relativePath = input.relativePath?.trim();
    if (!relativePath) {
      throw new NakamaApiError("path is required for remove_file.", 400);
    }

    resolveProfileSkillSupportingFilePath(
      input.orgId,
      input.profileId,
      name,
      relativePath
    );

    const pending = await this.pendingForSkillOrAlready(input, name);
    if (pending) {
      return pending;
    }

    const proposal = await this.insertProposal({
      ...input,
      action: "remove_file",
      content: null,
      patchNewString: null,
      patchOldString: null,
      relativePath,
      skillName: name,
    });

    return {
      message: `Staged remove_file for skill "${name}" path "${relativePath}" (proposal ${proposal.id}). An org admin must approve before it is removed.`,
      outcome: "created",
      proposalId: proposal.id,
      relativePath,
    };
  }

  private async pendingForSkillOrAlready(
    input: StageSkillProposalInput,
    name: string,
    contentForWarnings?: string
  ): Promise<StageSkillProposalResult | null> {
    const db = this.requireDatabase();
    const pending = await db.getPendingSkillProposalForSkill(
      input.orgId,
      input.profileId,
      name
    );
    if (!pending) {
      return null;
    }
    return {
      message: `A pending proposal already exists for skill "${name}".`,
      outcome: "already_pending",
      proposalId: pending.id,
      relativePath: pending.relativePath ?? undefined,
      ...(contentForWarnings
        ? { warnings: this.warningsForContent(contentForWarnings) }
        : {}),
    };
  }

  private async insertProposal(
    input: Omit<StageSkillProposalInput, "relativePath" | "content"> & {
      skillName: string;
      content: string | null;
      consolidateLoserSkillNames?: string[] | null;
      patchOldString: string | null;
      patchNewString: string | null;
      relativePath: string | null;
    }
  ): Promise<StoredSkillProposal> {
    const db = this.requireDatabase();
    const now = new Date().toISOString();
    const proposal: StoredSkillProposal = {
      action: input.action,
      consolidateLoserSkillNames: input.consolidateLoserSkillNames ?? null,
      content: input.content,
      createdAt: now,
      id: `skprop_${crypto.randomUUID().replace(/-/g, "")}`,
      orgId: input.orgId,
      patchNewString: input.patchNewString,
      patchOldString: input.patchOldString,
      profileId: input.profileId,
      proposedByUserId: input.proposedByUserId ?? null,
      relativePath: input.relativePath,
      reviewedAt: null,
      reviewerUserId: null,
      sessionId: input.sessionId ?? null,
      skillName: input.skillName,
      status: "pending",
    };
    await db.createSkillProposal(proposal);
    return proposal;
  }

  private async archiveConsolidateLosers(
    orgId: string,
    proposal: StoredSkillProposal
  ): Promise<void> {
    const loserNames = proposal.consolidateLoserSkillNames ?? [];
    if (loserNames.length === 0) {
      return;
    }

    const skills = this.requireSkillsService();
    const db = this.requireDatabase();
    const assigned = await db.listSkillsForProfile(proposal.profileId);
    const byName = new Map(assigned.map((skill) => [skill.name, skill]));

    for (const loserName of loserNames) {
      const skill = byName.get(loserName);
      if (!skill) {
        throw new NakamaApiError(
          `Consolidate loser skill "${loserName}" is not assigned to this profile.`,
          400
        );
      }
      const archived = await archiveSkillDirectory({
        orgId,
        profileId: proposal.profileId,
        skillName: loserName,
      });
      await skills.unassignArchivedProfileSkill(
        orgId,
        proposal.profileId,
        skill.id,
        archived.archivedDirectory
      );
    }
  }

  private async getProposal(
    orgId: string,
    proposalId: string
  ): Promise<StoredSkillProposal> {
    const db = this.requireDatabase();
    const proposal = await db.getSkillProposal(orgId, proposalId);
    if (!proposal) {
      throw new NakamaApiError("Skill proposal not found.", 404);
    }
    return proposal;
  }

  private async assertProfileOwnedSkill(
    orgId: string,
    profileId: string,
    name: string
  ): Promise<void> {
    const db = this.requireDatabase();
    // Callers pass names from readSkillName (already assertValidSkillName).
    const record = await db.getSkillByName(name, orgId);
    if (!record) {
      throw new NakamaApiError(`Skill "${name}" not found.`, 404);
    }
    if (isGlobalSkillSourcePath(record.sourcePath)) {
      throw new NakamaApiError(
        "Global skills cannot be modified by agents.",
        403
      );
    }
    if (!isPathWithinProfileSkillsDir(orgId, profileId, record.sourcePath)) {
      throw new NakamaApiError(
        `Skill "${name}" is not owned by this profile.`,
        403
      );
    }
  }

  private readSkillName(input: StageSkillProposalInput): string {
    const name = input.skillName?.trim();
    if (!name) {
      throw new NakamaApiError("name is required.", 400);
    }
    return assertValidSkillName(name);
  }

  private assertContentSize(content: string): void {
    if (Buffer.byteLength(content, "utf8") > MAX_SKILL_PROPOSAL_CONTENT_BYTES) {
      throw new NakamaApiError(
        "SKILL.md content exceeds the proposal size limit.",
        400
      );
    }
  }

  private assertPatchFieldSize(value: string): void {
    if (Buffer.byteLength(value, "utf8") > MAX_SKILL_PATCH_FIELD_LENGTH) {
      throw new NakamaApiError("Patch field exceeds the size limit.", 400);
    }
  }

  private warningsForContent(content: string): string[] | undefined {
    const warnings = detectOrgMemoryInjectionWarnings(content);
    return warnings.length > 0 ? warnings : undefined;
  }

  private warningsForPatch(
    oldString: string,
    newString: string
  ): string[] | undefined {
    const warnings = [
      ...detectOrgMemoryInjectionWarnings(oldString),
      ...detectOrgMemoryInjectionWarnings(newString),
    ];
    return warnings.length > 0 ? [...new Set(warnings)] : undefined;
  }

  private withWarnings(proposal: StoredSkillProposal): StoredSkillProposal & {
    warnings?: string[];
  } {
    if (
      (proposal.action === "create" ||
        proposal.action === "edit" ||
        proposal.action === "write_file") &&
      proposal.content
    ) {
      const warnings = this.warningsForContent(proposal.content);
      return warnings ? { ...proposal, warnings } : proposal;
    }
    if (
      proposal.action === "patch" &&
      proposal.patchOldString !== null &&
      proposal.patchNewString !== null
    ) {
      const warnings = this.warningsForPatch(
        proposal.patchOldString,
        proposal.patchNewString
      );
      return warnings ? { ...proposal, warnings } : proposal;
    }
    return proposal;
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
}
