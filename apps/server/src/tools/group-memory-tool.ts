import type { ToolContext, ToolDefinition } from "@nakama/core";
import { z } from "zod";
import {
  GROUP_MEMORY_CHARS,
  readGroupMemory,
  writeGroupMemory,
} from "../services/agent-group-memory";

const GroupMemoryInputSchema = z.object({
  entry: z.string().catch(""),
  replaces: z.string().optional().catch(undefined),
});

/** An entry is one "- fact" line; this is its fact, on one line. */
function factOf(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^\s*[-*]\s*/, "")
    .trim();
}

/**
 * Lets an agent in a group turn keep a fact for every member. The group is the
 * one whose shared folder the turn carries, so an agent can only reach the
 * memory of a group it is answering in. The read and write are synchronous,
 * so two turns in the same process cannot interleave and drop an entry.
 */
export const groupMemoryTool: ToolDefinition = {
  description:
    "Save a fact to this group's memory, which every member reads in every chat of the group, or fix or remove an entry. One short fact per entry: a decision, a name, a preference. Never save secrets.",
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

    const { entry, replaces = "" } = GroupMemoryInputSchema.parse(input);
    const fact = factOf(entry);
    const target = factOf(replaces);
    const memory = readGroupMemory(sharedDir);
    const lines = memory ? memory.split("\n") : [];
    const index = lines.findIndex((line) => factOf(line) === target);

    if (target && index < 0) {
      throw new Error(
        "No entry in the group memory matches `replaces`. Copy it exactly."
      );
    }

    if (!(target || fact)) {
      throw new Error("entry is required.");
    }

    if (!target && lines.some((line) => factOf(line) === fact)) {
      return { memory };
    }

    let next = [...lines, `- ${fact}`];

    if (target) {
      next = fact ? lines.with(index, `- ${fact}`) : lines.toSpliced(index, 1);
    }

    const content = next.join("\n");

    // Memory the user wrote past the cap may still shrink.
    if (content.length > GROUP_MEMORY_CHARS && content.length > memory.length) {
      throw new Error(
        `The group memory is full (${GROUP_MEMORY_CHARS} characters). Replace or remove an entry first.`
      );
    }

    writeGroupMemory(sharedDir, content);

    return { memory: readGroupMemory(sharedDir) };
  },
};
