import { join } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { readTextIfExists, writePrivateTextFile } from "../fs";
import { getProfileSoulDir } from "../soul/resolve";
import { MEMORY_TEMPLATE } from "../soul/templates";
import { jsonSchemaFromZod, parseToolInput, requiredTrimmedString } from "./schema";

export const MEMORY_MAX_BYTES = 4096;

export const updateProfileMemoryInputSchema = z
  .object({
    content: requiredTrimmedString("content"),
  })
  .strict();

export type MemoryAppendInput = z.infer<typeof updateProfileMemoryInputSchema>;

export interface MemoryAppendOutput {
  path: string;
  bytesTotal: number;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTemplateHeader(): string {
  const separator = "\n---\n";
  const index = MEMORY_TEMPLATE.indexOf(separator);
  if (index === -1) {
    return MEMORY_TEMPLATE;
  }
  return MEMORY_TEMPLATE.slice(0, index + separator.length - 1);
}

export const updateProfileMemoryTool: ToolDefinition<
  MemoryAppendInput,
  MemoryAppendOutput
> = {
  name: "update_profile_memory",
  description:
    "Record a fact, preference, decision, or observation in the active profile's MEMORY.md for cross-session continuity. Creates MEMORY.md if it doesn't exist. Use for things you know about the user — not step-by-step procedures (use profile skills for those).",
  parameters: jsonSchemaFromZod(updateProfileMemoryInputSchema),
  run(input, context) {
    return runUpdateProfileMemory(input, context);
  },
};

export async function runUpdateProfileMemory(
  input: unknown,
  context: ToolContext,
): Promise<MemoryAppendOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!orgId || !profileId) {
    throw new Error("orgId and profileId are required.");
  }

  const { content } = parseToolInput(updateProfileMemoryInputSchema, input);

  const soulDir = getProfileSoulDir(orgId, profileId);
  const memoryPath = join(soulDir, "MEMORY.md");

  const existing = await readTextIfExists(memoryPath);
  const today = getTodayDate();
  const todayHeader = `## ${today}`;

  let newContent: string;

  if (!existing) {
    const header = getTemplateHeader();
    newContent = `${header}\n\n${todayHeader}\n\n- ${content}`;
  } else if (existing.includes(todayHeader)) {
    newContent = appendTodayBullet(existing, todayHeader, content);
  } else {
    newContent = `${existing}\n\n${todayHeader}\n\n- ${content}`;
  }

  const totalBytes = Buffer.byteLength(newContent, "utf8");
  if (totalBytes > MEMORY_MAX_BYTES) {
    throw new Error(
      `MEMORY.md would exceed the maximum size of ${MEMORY_MAX_BYTES} bytes (${totalBytes} bytes). Archive old entries with archive_profile_memory to free space.`,
    );
  }

  await writePrivateTextFile(memoryPath, newContent);
  return { path: memoryPath, bytesTotal: totalBytes };
}

function appendTodayBullet(
  content: string,
  todayHeader: string,
  bullet: string,
): string {
  const lines = content.split("\n");
  let todayIndex = -1;
  let sectionEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === todayHeader) {
      todayIndex = i;
    } else if (todayIndex !== -1 && lines[i].startsWith("## ")) {
      sectionEnd = i;
      break;
    }
  }

  if (todayIndex === -1) return content;
  if (sectionEnd === -1) sectionEnd = lines.length;

  let insertAt = sectionEnd;
  for (let i = sectionEnd - 1; i > todayIndex; i--) {
    if (lines[i].trim() !== "") {
      insertAt = i + 1;
      break;
    }
  }

  lines.splice(insertAt, 0, `- ${bullet}`);
  return lines.join("\n");
}
