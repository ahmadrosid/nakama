import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";
import { getCustomToolsDir, guardFilePath, PathGuardError, type PathGuardOptions } from "./paths";
import { searchFilesTool } from "./search-files";
import { knowledgeBaseSearchTool } from "./knowledge-base-search";
import { webSearchTool } from "./web-search";
import { webFetchTool } from "./web-fetch";
import { archiveProfileMemoryTool } from "./archive-profile-memory";
import { updateProfileMemoryTool } from "./profile-memory";
import { emailTool } from "./email";
import {
  jsonSchemaFromZod,
  parseToolInput,
  readFileLimitSchema,
  readFileOffsetSchema,
  requiredTrimmedString,
  trimmedOptionalString,
} from "./schema";

export const writeFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    content: requiredTrimmedString("content"),
    cwd: trimmedOptionalString,
  })
  .strict();

export const deleteFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    cwd: trimmedOptionalString,
  })
  .strict();

export const readFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    cwd: trimmedOptionalString,
    offset: readFileOffsetSchema,
    limit: readFileLimitSchema,
  })
  .strict();

export const createSkillInputSchema = z
  .object({
    name: requiredTrimmedString("name"),
    description: requiredTrimmedString("description"),
    body: trimmedOptionalString,
    disableModelInvocation: z.boolean().optional(),
  })
  .strict();

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;
export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
export type ReadFileInput = z.infer<typeof readFileInputSchema>;
export type CreateSkillInput = z.infer<typeof createSkillInputSchema>;

export interface WriteFileOutput {
  path: string;
  bytesWritten: number;
}

export interface DeleteFileOutput {
  path: string;
  deleted: true;
}

export interface ReadFileOutput {
  path: string;
  content: string;
  bytesRead: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

interface FileToolRunOptions {
  workspaceRoot?: string;
}

let defaultGuardOptions: PathGuardOptions = {};

const BLOCKED_READ_BASENAMES = ["config.ini"];

export function setDefaultFileGuardOptions(options: PathGuardOptions): void {
  defaultGuardOptions = { ...options };
}

function requireProfileScope(context: ToolContext): { orgId: string; profileId: string } {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!orgId || !profileId) {
    throw new Error("orgId and profileId are required.");
  }

  return { orgId, profileId };
}

function buildFileGuardOptions(
  context: ToolContext,
  options: FileToolRunOptions = {},
): PathGuardOptions {
  const { orgId, profileId } = requireProfileScope(context);
  const workspaceRoot = options.workspaceRoot ?? getProfileSoulDir(orgId, profileId);

  return {
    ...defaultGuardOptions,
    allowedDirs: [workspaceRoot, getCustomToolsDir()],
    cwd: workspaceRoot,
  };
}

export const writeFileTool: ToolDefinition<WriteFileInput, WriteFileOutput> = {
  name: "write_file",
  description:
    "Write text content to a file in the active profile workspace. Creates parent directories if needed.",
  parameters: jsonSchemaFromZod(writeFileInputSchema),
  run(input, context) {
    return runWriteFile(input, context);
  },
};

export async function runWriteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<WriteFileOutput> {
  const parsed = parseToolInput(writeFileInputSchema, input);
  const contentBytes = Buffer.byteLength(parsed.content, "utf8");
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    contentBytes,
    guardOptions,
  );
  const filePath = guarded.resolved;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, parsed.content, "utf8");

  return { path: filePath, bytesWritten: contentBytes };
}

export const deleteFileTool: ToolDefinition<DeleteFileInput, DeleteFileOutput> = {
  name: "delete_file",
  description:
    "Delete a file from disk. Only files within the profile workspace or custom tools directory can be deleted.",
  parameters: jsonSchemaFromZod(deleteFileInputSchema),
  run(input, context) {
    return runDeleteFile(input, context);
  },
};

export async function runDeleteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<DeleteFileOutput> {
  const parsed = parseToolInput(deleteFileInputSchema, input);
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(parsed.path, parsed.cwd ?? null, undefined, guardOptions);
  await unlink(guarded.resolved);

  return { path: guarded.resolved, deleted: true };
}

export const readFileTool: ToolDefinition<ReadFileInput, ReadFileOutput> = {
  name: "read_file",
  description:
    "Read text from a file in the active profile workspace. Use offset/limit for large files.",
  parameters: jsonSchemaFromZod(readFileInputSchema),
  run(input, context) {
    return runReadFile(input, context);
  },
};

export async function runReadFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<ReadFileOutput> {
  const parsed = parseToolInput(readFileInputSchema, input);
  const guardOptions = buildFileGuardOptions(context, options);
  const maxBytes = guardOptions.maxFileBytes ?? 10 * 1024 * 1024;

  const guarded = await guardFilePath(parsed.path, parsed.cwd ?? null, undefined, guardOptions);
  const filePath = guarded.resolved;

  if (BLOCKED_READ_BASENAMES.includes(path.basename(filePath).toLowerCase())) {
    throw new PathGuardError(
      `Reading ${path.basename(filePath)} is not allowed`,
      "SPECIAL_FILE",
    );
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  if (fileStat.size > maxBytes) {
    throw new PathGuardError(
      `File content exceeds max ${maxBytes} bytes (got ${fileStat.size})`,
      "TOO_LARGE",
    );
  }

  const rawContent = await readFile(filePath, "utf8");
  const lines = rawContent.length === 0 ? [] : rawContent.split("\n");
  const totalLines = lines.length;
  const startLine = Math.min(
    Math.max(1, parsed.offset),
    totalLines === 0 ? 1 : totalLines + 1,
  );
  const startIndex = startLine - 1;
  const endIndex =
    parsed.limit != null ? Math.min(startIndex + parsed.limit, totalLines) : totalLines;
  const slice = lines.slice(startIndex, endIndex);
  const content = slice.join("\n");
  const endLine = slice.length > 0 ? startLine + slice.length - 1 : Math.max(0, startLine - 1);

  return {
    path: filePath,
    content,
    bytesRead: Buffer.byteLength(content, "utf8"),
    startLine,
    endLine,
    totalLines,
    truncated: endIndex < totalLines,
  };
}

export const createSkillTool: ToolDefinition<CreateSkillInput> = {
  name: "create_skill",
  description:
    "Save a step-by-step procedure or repeatable workflow as a skill for the active profile and assign it immediately. Use for actions the agent executes — multi-step instructions, workflows, and processes. Not for facts or observations (use update_profile_memory for those).",
  parameters: jsonSchemaFromZod(createSkillInputSchema),
  async run() {
    throw new Error("create_skill must be resolved by the TinyClaw server.");
  },
};

export const builtinTools: ToolDefinition[] = [
  writeFileTool,
  deleteFileTool,
  readFileTool,
  createSkillTool,
  searchFilesTool,
  knowledgeBaseSearchTool,
  webSearchTool,
  webFetchTool,
  updateProfileMemoryTool,
  archiveProfileMemoryTool,
  emailTool,
];

export { PathGuardError };
