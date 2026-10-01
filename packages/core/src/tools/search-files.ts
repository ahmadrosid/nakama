import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";
import { guardFilePath, resolveWorkspaceRoot } from "./paths";
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
    options.workspaceRoot ??
      context.workspaceRoot ??
      getProfileSoulDir(orgId, profileId)
  );
  const sessionRoot = context.workspaceRoot?.trim() || null;
  const searchRoot = await resolveSearchRoot(
    workspaceRoot,
    parsed.path ?? null,
    sessionRoot && path.isAbsolute(sessionRoot)
      ? path.join(workspaceRoot, "users")
      : null,
    sessionRoot
  );
  const args = buildRipgrepArgs({
    // A profile-wide walk would list every app user's artifacts by name, so
    // `users/` leaves the walk unless the search already starts inside it.
    excludes: excludeAppUserDirs(searchRoot, workspaceRoot, sessionRoot),
    glob: parsed.glob ?? null,
    maxResults: parsed.maxResults,
    query: parsed.query,
    regex: parsed.regex,
    searchRoot,
  });

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
  subPath: string | null,
  deniedUsersDir: string | null,
  sessionRoot: string | null
): Promise<string> {
  if (!subPath) {
    return workspaceRoot;
  }

  const allowedDirs = [workspaceRoot];

  if (sessionRoot) {
    allowedDirs.push(sessionRoot);
  }

  const guarded = await guardFilePath(subPath, workspaceRoot, undefined, {
    allowedDirs,
    cwd: workspaceRoot,
    deniedDirs: deniedUsersDir ? [deniedUsersDir] : [],
  });
  return guarded.resolved;
}

/**
 * `users` when the walk starts above it, nothing when the walk already starts
 * inside the session's own user directory: excluding it there would leave the
 * session unable to search its own files.
 */
function excludeAppUserDirs(
  searchRoot: string,
  workspaceRoot: string,
  sessionRoot: string | null
): string[] {
  if (!(sessionRoot && path.isAbsolute(sessionRoot))) {
    return [];
  }

  const withinOwn =
    searchRoot === sessionRoot || searchRoot.startsWith(sessionRoot + path.sep);

  return withinOwn || searchRoot !== workspaceRoot ? [] : ["users"];
}
