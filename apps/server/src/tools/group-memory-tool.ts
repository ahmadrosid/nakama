import type { ToolContext, ToolDefinition } from "@nakama/core";
import { z } from "zod";
import { groupWorkspace } from "../services/agent-group-workspace";

const GroupMemoryInputSchema = z.object({
  entry: z.string().catch(""),
  replaces: z.string().optional().catch(undefined),
});

/**
 * Lets an agent in a group turn keep a fact for every member. The group is the
 * one whose shared folder the turn carries, so an agent can only reach the
 * memory of a group it is answering in.
 */
export const groupMemoryTool: ToolDefinition = {
  description:
    "Save a fact to this group's memory, which every member reads in every chat of the group, or fix or remove an entry. One short fact per entry: a decision, a name, a preference, as the user stated or agreed to it. Never save an agent's suggestion the user has not agreed to, or secrets.",
  name: "update_group_memory",
  parallelSafe: false,
  parameters: {
    additionalProperties: false,
    properties: {
      entry: {
        description:
          "The fact to save, one short line. Leave it empty with `replaces` to remove that entry.",
        type: "string",
      },
      replaces: {
        description:
          "An entry to replace, copied exactly from the group memory. Omit it to add a new entry.",
        type: "string",
      },
    },
    required: ["entry"],
    type: "object",
  },
  async run(input, context: ToolContext) {
    const { sharedDir } = context;

    if (!sharedDir) {
      throw new Error("Group memory exists only in a group chat.");
    }

    const { entry, replaces } = GroupMemoryInputSchema.parse(input);

    return {
      memory: groupWorkspace(sharedDir).memory.addFact(entry, replaces),
    };
  },
};
