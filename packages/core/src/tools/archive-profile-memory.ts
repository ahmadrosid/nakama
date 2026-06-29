import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { archiveProfileMemoryBullets } from "../soul/memory-archive";
import { jsonSchemaFromZod, parseToolInput, requiredTrimmedString, trimmedOptionalString } from "./schema";

export const archiveProfileMemoryInputSchema = z
  .object({
    entries: z
      .array(requiredTrimmedString("entry"))
      .min(1, "entries must include at least one item.")
      .max(20, "entries must include at most 20 items."),
    reason: trimmedOptionalString,
  })
  .strict();

export type ArchiveProfileMemoryInput = z.infer<typeof archiveProfileMemoryInputSchema>;

export interface ArchiveProfileMemoryOutput {
  archived: number;
  activeBytes: number;
  archivePath: string;
}

export const archiveProfileMemoryTool: ToolDefinition<
  ArchiveProfileMemoryInput,
  ArchiveProfileMemoryOutput
> = {
  name: "archive_profile_memory",
  description:
    "Move facts out of the active profile MEMORY.md into data/memory-archive/ for long-term storage. Use when the user wants to forget, remove, or clean up old memory without deleting it. Archived entries are not loaded into chat context; use search_files or read_file to retrieve them later.",
  parameters: jsonSchemaFromZod(archiveProfileMemoryInputSchema),
  run(input, context) {
    return runArchiveProfileMemory(input, context);
  },
};

export async function runArchiveProfileMemory(
  input: unknown,
  context: ToolContext,
): Promise<ArchiveProfileMemoryOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!orgId || !profileId) {
    throw new Error("orgId and profileId are required.");
  }

  const { entries, reason } = parseToolInput(archiveProfileMemoryInputSchema, input);
  return archiveProfileMemoryBullets(orgId, profileId, entries, { reason });
}
