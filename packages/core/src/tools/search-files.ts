import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";
import { guardFilePath } from "./paths";
import {
  buildRipgrepArgs,
  runRipgrep,
  type RipgrepMatch,
} from "./ripgrep";
import {
  jsonSchemaFromZod,
  maxResultsSchema,
  optionalRegexFlag,
  parseToolInput,
  requiredTrimmedString,
  trimmedOptionalString,
} from "./schema";

export const searchFilesInputSchema = z
  .object({
    query: requiredTrimmedString("query"),
    path: trimmedOptionalString,
    glob: trimmedOptionalString,
    regex: optionalRegexFlag,
    maxResults: maxResultsSchema,
  })
  .strict();

export type SearchFilesInput = z.infer<typeof searchFilesInputSchema>;

export interface SearchFilesMatch extends RipgrepMatch {}

export interface SearchFilesOutput {
  query: string;
  root: string;
  matches: SearchFilesMatch[];
  matchCount: number;
  truncated: boolean;
}

interface SearchFilesOptions {
  workspaceRoot?: string;
}

export const searchFilesTool: ToolDefinition<SearchFilesInput, SearchFilesOutput> = {
  name: "search_files",
  description:
    "Search text in files under the active profile workspace and return compact matching snippets.",
  parameters: jsonSchemaFromZod(searchFilesInputSchema),
  parallelSafe: true,
  run(input, context) {
    return runSearchFiles(input, context);
  },
};

export async function runSearchFiles(
  input: unknown,
  context: ToolContext,
  options: SearchFilesOptions = {},
): Promise<SearchFilesOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!orgId || !profileId) {
    throw new Error("orgId and profileId are required.");
  }

  const parsed = parseToolInput(searchFilesInputSchema, input);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId),
  );
  const searchRoot = await resolveSearchRoot(workspaceRoot, parsed.path ?? null);
  const args = buildRipgrepArgs({
    query: parsed.query,
    searchRoot,
    glob: parsed.glob ?? null,
    regex: parsed.regex,
    maxResults: parsed.maxResults,
  });

  const searchResult = await runRipgrep(args, {
    workspaceRoot,
    searchRoot,
    maxResults: parsed.maxResults,
  });

  return {
    query: parsed.query,
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
