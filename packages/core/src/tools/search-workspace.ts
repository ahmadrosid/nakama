import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolDefinition } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";
import { guardFilePath } from "./paths";
import {
  buildRipgrepArgs,
  readMaxResults,
  readOptionalBoolean,
  readOptionalString,
  readRequiredString,
  runRipgrep,
  type RipgrepMatch,
} from "./ripgrep";

export interface SearchWorkspaceInput {
  query: string;
  path?: string;
  glob?: string;
  regex?: boolean;
  maxResults?: number;
}

export interface SearchWorkspaceMatch extends RipgrepMatch {}

export interface SearchWorkspaceOutput {
  query: string;
  root: string;
  matches: SearchWorkspaceMatch[];
  matchCount: number;
  truncated: boolean;
}

interface SearchWorkspaceOptions {
  workspaceRoot?: string;
}

export const searchWorkspaceTool: ToolDefinition<SearchWorkspaceInput, SearchWorkspaceOutput> = {
  name: "search_workspace",
  description:
    "Search text in files under the active profile workspace and return compact matching snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keyword or regex pattern to search for.",
      },
      path: {
        type: "string",
        description: "Optional file or subdirectory within the profile workspace.",
      },
      glob: {
        type: "string",
        description: "Optional ripgrep glob filter such as *.md or data/**.",
      },
      regex: {
        type: "boolean",
        description: "Treat query as regex when true. Defaults to true.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of matches to return. Defaults to 50, max 200.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  run(input, context) {
    return runSearchWorkspace(input, context);
  },
};

export async function runSearchWorkspace(
  input: unknown,
  context: ToolContext,
  options: SearchWorkspaceOptions = {},
): Promise<SearchWorkspaceOutput> {
  const profileId = context.profileId?.trim();
  if (!profileId) {
    throw new Error("profileId is required.");
  }

  const query = readRequiredString(input, "query");
  const subPath = readOptionalString(input, "path");
  const glob = readOptionalString(input, "glob");
  const regex = readOptionalBoolean(input, "regex") ?? true;
  const maxResults = readMaxResults(input);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(profileId),
  );
  const searchRoot = await resolveSearchRoot(workspaceRoot, subPath);
  const args = buildRipgrepArgs({
    query,
    searchRoot,
    glob,
    regex,
    maxResults,
  });

  const searchResult = await runRipgrep(args, {
    workspaceRoot,
    searchRoot,
    maxResults,
  });

  return {
    query,
    root: searchRoot,
    matches: searchResult.matches,
    matchCount: searchResult.matches.length,
    truncated: searchResult.truncated,
  };
}

async function resolveSearchRoot(
  workspaceRoot: string,
  subPath: string | null,
): Promise<string> {
  if (!subPath) {
    return workspaceRoot;
  }

  const guarded = await guardFilePath(subPath, workspaceRoot, undefined, {
    allowedDirs: [workspaceRoot],
    cwd: workspaceRoot,
  });
  return guarded.resolved;
}

async function resolveWorkspaceRoot(rawWorkspaceRoot: string): Promise<string> {
  try {
    return await realpath(rawWorkspaceRoot);
  } catch {
    return path.resolve(rawWorkspaceRoot);
  }
}
