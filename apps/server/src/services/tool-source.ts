import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolSourceResponse } from "@nakama/core";
import { NakamaApiError, pathExists } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import { getCustomToolHandler } from "./custom-tool-handlers";
import { readHandlerModulePath } from "./custom-tool-shared";

const require = createRequire(import.meta.url);
const corePackageRoot = path.dirname(
  require.resolve("@nakama/core/package.json")
);
const serverSrcDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const BUILTIN_SOURCE_BY_NAME: Record<
  string,
  { filePath: string; displayPath: string }
> = {
  delete_file: {
    displayPath: "packages/core/src/tools/builtin.ts",
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
  },
  edit_file: {
    displayPath: "packages/core/src/tools/builtin.ts",
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
  },
  email: {
    displayPath: "packages/core/src/tools/email.ts",
    filePath: path.join(corePackageRoot, "src/tools/email.ts"),
  },
  read_file: {
    displayPath: "packages/core/src/tools/builtin.ts",
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
  },
  search_files: {
    displayPath: "packages/core/src/tools/search-files.ts",
    filePath: path.join(corePackageRoot, "src/tools/search-files.ts"),
  },
  web_search: {
    displayPath: "packages/core/src/tools/web-search.ts",
    filePath: path.join(corePackageRoot, "src/tools/web-search.ts"),
  },
  write_file: {
    displayPath: "packages/core/src/tools/builtin.ts",
    filePath: path.join(corePackageRoot, "src/tools/builtin.ts"),
  },
};

const BASH_SOURCE = {
  displayPath: "apps/server/src/tools/bash.ts",
  filePath: path.join(serverSrcDir, "tools/bash.ts"),
};

const SUB_AGENT_SOURCE = {
  displayPath: "apps/server/src/tools/sub-agent-tool.ts",
  filePath: path.join(serverSrcDir, "tools/sub-agent-tool.ts"),
};

const GENERATE_IMAGE_SOURCE = {
  displayPath: "apps/server/src/tools/generate-image-tool.ts",
  filePath: path.join(serverSrcDir, "tools/generate-image-tool.ts"),
};

export async function readToolSource(
  record: StoredToolRecord
): Promise<ToolSourceResponse> {
  if (getCustomToolHandler(record.handlerType)) {
    return readCustomToolSource(record);
  }

  if (record.handlerType === "bash") {
    return readFixedToolSource(BASH_SOURCE, "typescript");
  }

  if (record.handlerType === "sub_agent") {
    return readFixedToolSource(SUB_AGENT_SOURCE, "typescript");
  }

  if (record.handlerType === "generate_image") {
    return readFixedToolSource(GENERATE_IMAGE_SOURCE, "typescript");
  }

  if (record.handlerType === "builtin") {
    const source = BUILTIN_SOURCE_BY_NAME[record.name];

    if (!source) {
      throw new NakamaApiError(
        `No source mapping for built-in tool "${record.name}".`,
        404
      );
    }

    return readFixedToolSource(source, "typescript");
  }

  throw new NakamaApiError(
    `Unsupported tool handler type: ${record.handlerType}.`,
    404
  );
}

async function readCustomToolSource(
  record: StoredToolRecord
): Promise<ToolSourceResponse> {
  const handler = getCustomToolHandler(record.handlerType);

  if (!handler) {
    throw new NakamaApiError(
      `Unsupported tool handler type: ${record.handlerType}.`,
      404
    );
  }

  const modulePath = readHandlerModulePath(record.handlerConfig);

  if (!modulePath) {
    throw new NakamaApiError(
      `Tool "${record.name}" is missing handlerConfig.modulePath.`,
      404
    );
  }

  let resolvedPath: string;

  try {
    resolvedPath = handler.resolveModulePath(modulePath);
  } catch (error) {
    throw new NakamaApiError(
      error instanceof Error ? error.message : String(error),
      404
    );
  }

  if (!(await pathExists(resolvedPath))) {
    throw new NakamaApiError(`Tool module not found: ${modulePath}`, 404);
  }

  const content = await readFile(resolvedPath, "utf8");

  return {
    content,
    language: handler.language,
    path: modulePath,
  };
}

async function readFixedToolSource(
  source: { filePath: string; displayPath: string },
  language: ToolSourceResponse["language"]
): Promise<ToolSourceResponse> {
  if (!(await pathExists(source.filePath))) {
    throw new NakamaApiError(
      `Tool source file not found: ${source.displayPath}`,
      404
    );
  }

  const content = await readFile(source.filePath, "utf8");

  return {
    content,
    language,
    path: source.displayPath,
  };
}
