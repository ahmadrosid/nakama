import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { getKnowledgeBaseDir } from "../knowledge-base/paths";
import { getProfileSoulDir } from "../soul/resolve";
import {
  guardFilePath,
  refuseKnowledgeIndexPath,
  resolveWorkspaceRoot,
} from "./paths";
import { buildRipgrepArgs, type RipgrepMatch, runRipgrep } from "./ripgrep";
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
    glob: trimmedOptionalString,
    maxResults: maxResultsSchema,
    path: trimmedOptionalString,
    query: requiredTrimmedString("query"),
    regex: optionalRegexFlag,
  })
  .strict();

export type SearchFilesInput = z.infer<typeof searchFilesInputSchema>;

export interface SearchFilesOutput {
  matchCount: number;
  matches: RipgrepMatch[];
  query: string;
  root: string;
  truncated: boolean;
}

interface SearchFilesOptions {
  workspaceRoot?: string;
}

export const searchFilesTool: ToolDefinition<
  SearchFilesInput,
  SearchFilesOutput
> = {
  description:
    "Search text in files under the active profile workspace and return compact matching snippets.",
  name: "search_files",
  parallelSafe: true,
  parameters: jsonSchemaFromZod(searchFilesInputSchema),
  run(input, context) {
    return runSearchFiles(input, context);
  },
};

export async function runSearchFiles(
  input: unknown,
  context: ToolContext,
  options: SearchFilesOptions = {}
): Promise<SearchFilesOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!(orgId && profileId)) {
    throw new Error("orgId and profileId are required.");
  }

  const parsed = parseToolInput(searchFilesInputSchema, input);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
  );
  const searchRoot = await resolveSearchRoot(
    workspaceRoot,
    parsed.path ?? null
  );
  const knowledgeRoot = getKnowledgeBaseDir(orgId, profileId);
  if (
    searchRoot === knowledgeRoot ||
    searchRoot.startsWith(`${knowledgeRoot}${path.sep}`)
  ) {
    throw new Error("Use knowledge_base_search for knowledge documents.");
  }
  const args = buildRipgrepArgs({
    glob: parsed.glob ?? null,
    maxResults: parsed.maxResults,
    query: parsed.query,
    regex: parsed.regex,
    searchRoot,
  });
  args.splice(
    -3,
    0,
    "--glob",
    "!**/knowledge-base/index.md",
    "--glob",
    "!**/knowledge-base/index.meta.json",
    "--glob",
    "!**/knowledge-base/*.index.json",
    "--glob",
    "!**/knowledge-base/index-settings.json",
    "--glob",
    "!**/knowledge-base/index-work.json"
  );

  const searchResult = await runRipgrep(args, {
    maxResults: parsed.maxResults,
    searchRoot,
    workspaceRoot,
  });

  return {
    matchCount: searchResult.matches.length,
    matches: searchResult.matches,
    query: parsed.query,
    root: searchRoot,
    truncated: searchResult.truncated,
  };
}

async function resolveSearchRoot(
  workspaceRoot: string,
  subPath: string | null
): Promise<string> {
  if (!subPath) {
    return workspaceRoot;
  }

  const guarded = await guardFilePath(subPath, workspaceRoot, undefined, {
    allowedDirs: [workspaceRoot],
    cwd: workspaceRoot,
  });
  refuseKnowledgeIndexPath(guarded.resolved);
  return guarded.resolved;
}
