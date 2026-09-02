import {
  type AgentChannel,
  parseRawProfileSkillContent,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import type { SkillProposalAction } from "@nakama/db";
import type { SkillProposalService } from "../services/skill-proposal-service";
import type { SkillsService } from "../services/skills-service";

export interface SkillManageToolDeps {
  skillProposalService?: SkillProposalService | null;
  skillsService: SkillsService;
}

type SkillManageAction = SkillProposalAction;

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();
  if (!orgId) {
    throw new Error("Organization context is required.");
  }
  return orgId;
}

function requireProfileId(context: ToolContext): string {
  const profileId = context.profileId?.trim();
  if (!profileId) {
    throw new Error("Profile context is required.");
  }
  return profileId;
}

/**
 * Which channels get the skill-management surface. Total over `AgentChannel`,
 * so a new channel fails the typecheck here instead of inheriting `false` in
 * silence. `agent-service` reads the same table when it decides whether to
 * attach the tools, so the offer and this gate cannot drift apart.
 */
export const SKILL_MANAGE_CHANNELS = {
  automation: false,
  cli: true,
  discord: false,
  subagent: false,
  task: false,
  telegram: false,
  web: true,
  whatsapp: false,
} as const satisfies Record<AgentChannel, boolean>;

/**
 * Deny-by-default role gate for skill_manage. Viewers are blocked; an undefined
 * role also blocks — same pattern as org-memory tools.
 */
function requireSkillManageAccess(context: ToolContext): {
  orgId: string;
  profileId: string;
} {
  if (context.automationId?.trim()) {
    throw new Error("skill_manage is not available during automation runs.");
  }

  const channel = context.channel;
  if (channel !== undefined && !SKILL_MANAGE_CHANNELS[channel]) {
    throw new Error(
      "skill_manage is only available in interactive web or CLI chat."
    );
  }

  const orgId = requireOrgId(context);
  const profileId = requireProfileId(context);
  const role = context.orgRole;
  if (role === undefined || role === null) {
    throw new Error("skill_manage requires an organization role.");
  }
  if (role === "viewer") {
    throw new Error("Viewers cannot manage skills.");
  }
  return { orgId, profileId };
}

function readRawString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAction(input: unknown): SkillManageAction {
  if (typeof input !== "object" || input === null || !("action" in input)) {
    throw new Error(
      "action is required (create | patch | edit | delete | write_file | remove_file)."
    );
  }
  const value = (input as Record<string, unknown>).action;
  if (
    value === "create" ||
    value === "patch" ||
    value === "edit" ||
    value === "delete" ||
    value === "write_file" ||
    value === "remove_file"
  ) {
    return value;
  }
  throw new Error(
    "action must be create, patch, edit, delete, write_file, or remove_file."
  );
}

function skillManageResult(options: {
  action: SkillManageAction;
  name: string;
  assigned: boolean;
  context: ToolContext;
  description?: string;
  created?: boolean;
  path?: string;
}) {
  options.context.onSkillCatalogChange?.();
  const matchHint =
    options.action === "delete"
      ? "The skill was removed from this profile (disk, assignment, and DB row). Keyword match and /skill will no longer find it."
      : options.action === "write_file" || options.action === "remove_file"
        ? "Supporting file change applied under the profile skill directory."
        : "The skill is assigned for this profile. Keyword match and /skill work on later turns; the session skills catalog refreshes before the next turn.";

  return {
    action: options.action,
    assigned: options.assigned,
    name: options.name,
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    ...(options.created === undefined ? {} : { created: options.created }),
    ...(options.path === undefined ? {} : { path: options.path }),
    matchHint,
  };
}

function stagedSkillManageResult(options: {
  action: SkillManageAction;
  name: string;
  proposalId?: string;
  outcome: "created" | "already_pending";
  message: string;
  path?: string;
}) {
  return {
    action: options.action,
    message: options.message,
    name: options.name,
    outcome: options.outcome,
    proposalId: options.proposalId,
    staged: true as const,
    ...(options.path === undefined ? {} : { path: options.path }),
    matchHint:
      "The skill change is pending admin approval and is not live yet. It will not match until an org admin approves the proposal.",
  };
}

export function createSkillManageTools(
  deps: SkillManageToolDeps
): ToolDefinition[] {
  const { skillsService: service, skillProposalService = null } = deps;

  return [
    {
      description:
        "Create, patch, edit, or delete reusable profile skills (SKILL.md under the profile skills directory), or write/remove supporting files under a skill directory, with auto-assign for skill mutations. When write approval is enabled for this org/profile, changes are staged for admin review instead of applying immediately. Prefer patch with unique old_string/new_string over edit for small fixes. Crystallize a skill after complex multi-step success (about 5+ tool calls), error recovery, or when the user corrects your approach — do not dump procedures into MEMORY.md.",
      name: "skill_manage",
      parallelSafe: false,
      parameters: {
        additionalProperties: false,
        properties: {
          action: {
            description:
              "create = new/adopt skill; patch = targeted edit; edit = full SKILL.md replace; delete = remove profile-owned skill; write_file/remove_file = supporting files under the skill dir.",
            enum: [
              "create",
              "patch",
              "edit",
              "delete",
              "write_file",
              "remove_file",
            ],
            type: "string",
          },
          content: {
            description:
              "Full SKILL.md markdown including YAML frontmatter (create/edit), or supporting file body (write_file).",
            type: "string",
          },
          name: {
            description:
              "Skill name (kebab-case). Required for patch, edit, delete, write_file, and remove_file.",
            type: "string",
          },
          new_string: {
            description:
              "Replacement text for old_string. Required for patch (may be empty).",
            type: "string",
          },
          old_string: {
            description:
              "Exact unique substring to replace in SKILL.md. Required for patch.",
            type: "string",
          },
          path: {
            description:
              "Relative path under the skill directory. Required for write_file and remove_file (not SKILL.md or tool.ts/tool.js).",
            type: "string",
          },
        },
        required: ["action"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const { orgId, profileId } = requireSkillManageAccess(context);
        const action = readAction(input);

        if (
          skillProposalService !== null &&
          (await skillProposalService.isWriteApprovalRequired(orgId, profileId))
        ) {
          if (action === "create") {
            const content = readRawString(input, "content");
            if (!content?.trim()) {
              throw new Error(
                "content is required for create (full SKILL.md markdown)."
              );
            }

            const staged = await skillProposalService.stageProposal({
              action: "create",
              content,
              orgId,
              profileId,
              proposedByUserId: context.userId ?? null,
              sessionId: context.sessionId ?? null,
            });

            const { name } = parseRawProfileSkillContent(
              content,
              orgId,
              profileId
            );

            return stagedSkillManageResult({
              action: "create",
              message: staged.message,
              name,
              outcome: staged.outcome,
              proposalId: staged.proposalId,
            });
          }

          if (action === "patch") {
            const name = readString(input, "name");
            const oldString = readRawString(input, "old_string");
            const newString = readRawString(input, "new_string");

            if (!name) {
              throw new Error("name is required for patch.");
            }
            if (oldString === null || oldString === "") {
              throw new Error("old_string is required for patch.");
            }
            if (newString === null) {
              throw new Error("new_string is required for patch.");
            }

            const staged = await skillProposalService.stageProposal({
              action: "patch",
              newString,
              oldString,
              orgId,
              profileId,
              proposedByUserId: context.userId ?? null,
              sessionId: context.sessionId ?? null,
              skillName: name,
            });

            return stagedSkillManageResult({
              action: "patch",
              message: staged.message,
              name,
              outcome: staged.outcome,
              proposalId: staged.proposalId,
            });
          }

          if (action === "edit") {
            const name = readString(input, "name");
            const content = readRawString(input, "content");
            if (!name) {
              throw new Error("name is required for edit.");
            }
            if (!content?.trim()) {
              throw new Error(
                "content is required for edit (full SKILL.md markdown)."
              );
            }

            const staged = await skillProposalService.stageProposal({
              action: "edit",
              content,
              orgId,
              profileId,
              proposedByUserId: context.userId ?? null,
              sessionId: context.sessionId ?? null,
              skillName: name,
            });

            return stagedSkillManageResult({
              action: "edit",
              message: staged.message,
              name,
              outcome: staged.outcome,
              proposalId: staged.proposalId,
            });
          }

          if (action === "write_file") {
            const name = readString(input, "name");
            const relativePath = readString(input, "path");
            const content = readRawString(input, "content");
            if (!name) {
              throw new Error("name is required for write_file.");
            }
            if (!relativePath) {
              throw new Error("path is required for write_file.");
            }
            if (content === null) {
              throw new Error("content is required for write_file.");
            }

            const staged = await skillProposalService.stageProposal({
              action: "write_file",
              content,
              orgId,
              profileId,
              proposedByUserId: context.userId ?? null,
              relativePath,
              sessionId: context.sessionId ?? null,
              skillName: name,
            });

            return stagedSkillManageResult({
              action: "write_file",
              message: staged.message,
              name,
              outcome: staged.outcome,
              proposalId: staged.proposalId,
              ...(staged.relativePath || staged.outcome === "created"
                ? { path: staged.relativePath ?? relativePath }
                : {}),
            });
          }

          if (action === "remove_file") {
            const name = readString(input, "name");
            const relativePath = readString(input, "path");
            if (!name) {
              throw new Error("name is required for remove_file.");
            }
            if (!relativePath) {
              throw new Error("path is required for remove_file.");
            }

            const staged = await skillProposalService.stageProposal({
              action: "remove_file",
              orgId,
              profileId,
              proposedByUserId: context.userId ?? null,
              relativePath,
              sessionId: context.sessionId ?? null,
              skillName: name,
            });

            return stagedSkillManageResult({
              action: "remove_file",
              message: staged.message,
              name,
              outcome: staged.outcome,
              proposalId: staged.proposalId,
              ...(staged.relativePath || staged.outcome === "created"
                ? { path: staged.relativePath ?? relativePath }
                : {}),
            });
          }

          const name = readString(input, "name");
          if (!name) {
            throw new Error("name is required for delete.");
          }

          const staged = await skillProposalService.stageProposal({
            action: "delete",
            orgId,
            profileId,
            proposedByUserId: context.userId ?? null,
            sessionId: context.sessionId ?? null,
            skillName: name,
          });

          return stagedSkillManageResult({
            action: "delete",
            message: staged.message,
            name,
            outcome: staged.outcome,
            proposalId: staged.proposalId,
          });
        }

        if (action === "create") {
          const content = readRawString(input, "content");
          if (!content?.trim()) {
            throw new Error(
              "content is required for create (full SKILL.md markdown)."
            );
          }

          const response = await service.createAndAssignRawSkillToProfile(
            orgId,
            profileId,
            content,
            {
              changeMeta: {
                actorUserId: context.userId ?? null,
                source: "skill_manage",
              },
            }
          );

          return skillManageResult({
            action: "create",
            assigned: true,
            context,
            created: response.created,
            description: response.skill.description,
            name: response.skill.name,
          });
        }

        if (action === "patch") {
          const name = readString(input, "name");
          const oldString = readRawString(input, "old_string");
          const newString = readRawString(input, "new_string");

          if (!name) {
            throw new Error("name is required for patch.");
          }
          if (oldString === null || oldString === "") {
            throw new Error("old_string is required for patch.");
          }
          if (newString === null) {
            throw new Error("new_string is required for patch.");
          }

          const response = await service.patchAssignedProfileSkill(
            orgId,
            profileId,
            name,
            oldString,
            newString,
            {
              actorUserId: context.userId ?? null,
              source: "skill_manage",
            }
          );

          return skillManageResult({
            action: "patch",
            assigned: true,
            context,
            description: response.skill.description,
            name: response.skill.name,
          });
        }

        if (action === "edit") {
          const name = readString(input, "name");
          const content = readRawString(input, "content");
          if (!name) {
            throw new Error("name is required for edit.");
          }
          if (!content?.trim()) {
            throw new Error(
              "content is required for edit (full SKILL.md markdown)."
            );
          }

          const response = await service.editAssignedProfileSkill(
            orgId,
            profileId,
            name,
            content,
            {
              actorUserId: context.userId ?? null,
              source: "skill_manage",
            }
          );

          return skillManageResult({
            action: "edit",
            assigned: true,
            context,
            description: response.skill.description,
            name: response.skill.name,
          });
        }

        if (action === "write_file") {
          const name = readString(input, "name");
          const relativePath = readString(input, "path");
          const content = readRawString(input, "content");
          if (!name) {
            throw new Error("name is required for write_file.");
          }
          if (!relativePath) {
            throw new Error("path is required for write_file.");
          }
          if (content === null) {
            throw new Error("content is required for write_file.");
          }

          const written = await service.writeAssignedProfileSkillSupportingFile(
            orgId,
            profileId,
            name,
            relativePath,
            content
          );

          return skillManageResult({
            action: "write_file",
            assigned: true,
            context,
            name: written.skillName,
            path: written.relativePath,
          });
        }

        if (action === "remove_file") {
          const name = readString(input, "name");
          const relativePath = readString(input, "path");
          if (!name) {
            throw new Error("name is required for remove_file.");
          }
          if (!relativePath) {
            throw new Error("path is required for remove_file.");
          }

          const removed =
            await service.removeAssignedProfileSkillSupportingFile(
              orgId,
              profileId,
              name,
              relativePath
            );

          return skillManageResult({
            action: "remove_file",
            assigned: true,
            context,
            name: removed.skillName,
            path: removed.relativePath,
          });
        }

        const name = readString(input, "name");
        if (!name) {
          throw new Error("name is required for delete.");
        }

        await service.deleteAssignedProfileSkill(orgId, profileId, name, {
          actorUserId: context.userId ?? null,
          source: "skill_manage",
        });

        return skillManageResult({
          action: "delete",
          assigned: false,
          context,
          name,
        });
      },
    },
  ];
}
