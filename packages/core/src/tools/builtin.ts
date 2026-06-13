import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolDefinition } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";
import { getCustomToolsDir, guardFilePath, PathGuardError, type PathGuardOptions } from "./paths";
import { searchWorkspaceTool } from "./search-workspace";
import { webSearchTool } from "./web-search";

export interface WriteFileInput {
  path: string;
  content: string;
  cwd?: string;
}

export interface WriteFileOutput {
  path: string;
  bytesWritten: number;
}

export interface DeleteFileInput {
  path: string;
  cwd?: string;
}

export interface DeleteFileOutput {
  path: string;
  deleted: true;
}

interface FileToolRunOptions {
  workspaceRoot?: string;
}

let defaultGuardOptions: PathGuardOptions = {};

export function setDefaultFileGuardOptions(options: PathGuardOptions): void {
  defaultGuardOptions = { ...options };
}

function buildFileGuardOptions(
  context: ToolContext,
  options: FileToolRunOptions = {},
): PathGuardOptions {
  const profileId = context.profileId?.trim();
  if (!profileId) {
    throw new Error("profileId is required.");
  }

  const workspaceRoot = options.workspaceRoot ?? getProfileSoulDir(profileId);

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
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path to write, relative to the profile workspace unless absolute.",
      },
      content: { type: "string", description: "Text content to write." },
      cwd: {
        type: "string",
        description:
          "Optional base directory within the profile workspace for relative paths. Defaults to the profile workspace root.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  run(input, context) {
    return runWriteFile(input, context);
  },
};

export async function runWriteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<WriteFileOutput> {
  const rawPath = readRequiredString(input, "path");
  const content = readRequiredString(input, "content");
  const rawCwd = readOptionalString(input, "cwd");
  const contentBytes = Buffer.byteLength(content, "utf8");
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(rawPath, rawCwd, contentBytes, guardOptions);
  const filePath = guarded.resolved;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return { path: filePath, bytesWritten: contentBytes };
}

export const deleteFileTool: ToolDefinition<DeleteFileInput, DeleteFileOutput> = {
  name: "delete_file",
  description:
    "Delete a file from disk. Only files within the profile workspace or custom tools directory can be deleted.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "File path to delete. Must be within the profile workspace or custom tools directory.",
      },
      cwd: {
        type: "string",
        description:
          "Optional base directory within the profile workspace for relative paths. Defaults to the profile workspace root.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  run(input, context) {
    return runDeleteFile(input, context);
  },
};

export async function runDeleteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<DeleteFileOutput> {
  const rawPath = readRequiredString(input, "path");
  const rawCwd = readOptionalString(input, "cwd");
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(rawPath, rawCwd, undefined, guardOptions);
  await unlink(guarded.resolved);

  return { path: guarded.resolved, deleted: true };
}

export const builtinTools: ToolDefinition[] = [
  writeFileTool,
  deleteFileTool,
  searchWorkspaceTool,
  webSearchTool,
];

function readRequiredString(input: unknown, key: string): string {
  const value = readOptionalString(input, key);

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function readOptionalString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export { PathGuardError };
