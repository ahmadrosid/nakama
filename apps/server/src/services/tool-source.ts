import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolSourceResponse } from "@nakama/core";
import { pathExists, NakamaApiError } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import { resolveJavascriptModulePath } from "./javascript-tool-loader";

const require = createRequire(import.meta.url);
const corePackageRoot = path.dirname(require.resolve("@nakama/core/package.json"));
const serverSrcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUILTIN_SOURCE_BY_NAME: Record<string, { filePath: string; displayPath: string }> = {
  write_file: {
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
    displayPath: "packages/core/src/tools/builtin.ts",
  },
  delete_file: {
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
    displayPath: "packages/core/src/tools/builtin.ts",
  },
  edit_file: {
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
    displayPath: "packages/core/src/tools/builtin.ts",
  },
  read_file: {
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
    displayPath: "packages/core/src/tools/builtin.ts",
  },
  search_files: {
    filePath: path.join(corePackageRoot, "src/tools/search-files.ts"),
    displayPath: "packages/core/src/tools/search-files.ts",
  },
  web_search: {
    filePath: path.join(corePackageRoot, "src/tools/web-search.ts"),
    displayPath: "packages/core/src/tools/web-search.ts",
  },
  email: {
    filePath: path.join(corePackageRoot, "src/tools/email.ts"),
    displayPath: "packages/core/src/tools/email.ts",
  },
};

const BASH_SOURCE = {
  filePath: path.join(serverSrcDir, "tools/bash.ts"),
  displayPath: "apps/server/src/tools/bash.ts",
};

export async function readToolSource(record: StoredToolRecord): Promise<ToolSourceResponse> {
  if (record.handlerType === "javascript") {
    return readJavascriptToolSource(record);
  }

  if (record.handlerType === "bash") {
    return readFixedToolSource(BASH_SOURCE, "typescript");
  }

  if (record.handlerType === "builtin") {
    const source = BUILTIN_SOURCE_BY_NAME[record.name];

    if (!source) {
      throw new NakamaApiError(`No source mapping for built-in tool "${record.name}".`, 404);
    }

    return readFixedToolSource(source, "typescript");
  }

  throw new NakamaApiError(`Unsupported tool handler type: ${record.handlerType}.`, 404);
}

async function readJavascriptToolSource(record: StoredToolRecord): Promise<ToolSourceResponse> {
  const modulePath = readJavascriptModulePath(record.handlerConfig);

  if (!modulePath) {
    throw new NakamaApiError(
      `Tool "${record.name}" is missing handlerConfig.modulePath.`,
      404,
    );
  }

  let resolvedPath: string;

  try {
    resolvedPath = resolveJavascriptModulePath(modulePath);
  } catch (error) {
    throw new NakamaApiError(
      error instanceof Error ? error.message : String(error),
      404,
    );
  }

  if (!(await pathExists(resolvedPath))) {
    throw new NakamaApiError(`Tool module not found: ${modulePath}`, 404);
  }

  const content = await readFile(resolvedPath, "utf8");

  return {
    path: modulePath,
    content,
    language: "javascript",
  };
}

async function readFixedToolSource(
  source: { filePath: string; displayPath: string },
  language: ToolSourceResponse["language"],
): Promise<ToolSourceResponse> {
  if (!(await pathExists(source.filePath))) {
    throw new NakamaApiError(`Tool source file not found: ${source.displayPath}`, 404);
  }

  const content = await readFile(source.filePath, "utf8");

  return {
    path: source.displayPath,
    content,
    language,
  };
}

function readJavascriptModulePath(handlerConfig: unknown): string | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const modulePath = (handlerConfig as Record<string, unknown>).modulePath;

  if (typeof modulePath !== "string" || !modulePath.trim()) {
    return null;
  }

  return modulePath.trim();
}
