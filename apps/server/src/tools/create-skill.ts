import type { ToolDefinition } from "@tinyclaw/core";
import type { SkillsService } from "../services/skills-service";

export function createCreateSkillTool(skillsService: SkillsService): ToolDefinition {
  return {
    name: "create_skill",
    description:
      "Create a reusable skill for the active profile and assign it immediately.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Unique skill name for the active profile.",
        },
        description: {
          type: "string",
          description: "Short summary explaining when the skill should be used.",
        },
        body: {
          type: "string",
          description: "Optional skill instructions to save in SKILL.md.",
        },
        disableModelInvocation: {
          type: "boolean",
          description: "When true, the skill only activates on explicit invocation.",
        },
      },
      required: ["name", "description"],
      additionalProperties: false,
    },
    async run(input, context) {
      const profileId = context.profileId?.trim();

      if (!profileId) {
        throw new Error("Skill creation must run from an active profile session.");
      }

      const name = readString(input, "name");
      const description = readString(input, "description");

      if (!name || !description) {
        throw new Error("name and description are required.");
      }

      return skillsService.createAndAssignSkillToProfile(profileId, {
        name,
        description,
        body: readOptionalString(input, "body") ?? undefined,
        disableModelInvocation: readBoolean(input, "disableModelInvocation") ?? undefined,
      });
    },
  };
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : null;
}

function readBoolean(input: unknown, key: string): boolean | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}
