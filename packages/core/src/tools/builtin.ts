import { mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "../contract";
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

export const writeFileTool: ToolDefinition<WriteFileInput, WriteFileOutput> = {
  name: "write_file",
  description: "Write text content to a file. Creates parent directories if needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write." },
      content: { type: "string", description: "Text content to write." },
      cwd: {
        type: "string",
        description: "Base directory for relative paths. Defaults to the server working directory.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async run(input) {
    const filePath = resolveFilePath(input, "path");
    const content = readRequiredString(input, "content");

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");

    return {
      path: filePath,
      bytesWritten: Buffer.byteLength(content, "utf8"),
    };
  },
};

export const deleteFileTool: ToolDefinition<DeleteFileInput, DeleteFileOutput> = {
  name: "delete_file",
  description: "Delete a file from disk.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to delete." },
      cwd: {
        type: "string",
        description: "Base directory for relative paths. Defaults to the server working directory.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async run(input) {
    const filePath = resolveFilePath(input, "path");

    await unlink(filePath);

    return {
      path: filePath,
      deleted: true,
    };
  },
};

export const builtinTools: ToolDefinition[] = [
  writeFileTool,
  deleteFileTool,
  webSearchTool,
];

function resolveFilePath(input: unknown, key: string): string {
  const filePath = expandHome(readRequiredString(input, key));
  const cwd = expandHome(readOptionalString(input, "cwd") ?? process.cwd());

  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(cwd, filePath);
}

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }

  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

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
