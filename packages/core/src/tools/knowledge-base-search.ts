import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  KNOWLEDGE_BASE_EXTRACTED_SUFFIX,
} from "../knowledge-base/paths";
import {
  ensureKnowledgeBaseDirs,
  listKnowledgeBaseDocuments,
} from "../knowledge-base/store";
import { getProfileSoulDir } from "../soul/resolve";
import { resolveWorkspaceRoot } from "./paths";
import { buildRipgrepArgs, type RipgrepMatch, runRipgrep } from "./ripgrep";
import {
  jsonSchemaFromZod,
  maxResultsSchema,
  optionalRegexFlag,
  parseToolInput,
  requiredTrimmedString,
  trimmedOptionalString,
} from "./schema";

export const knowledgeBaseSearchInputSchema = z
  .object({
    filename: trimmedOptionalString,
    maxResults: maxResultsSchema,
    query: requiredTrimmedString("query"),
    regex: optionalRegexFlag,
  })
  .strict();

export type KnowledgeBaseSearchInput = z.infer<
  typeof knowledgeBaseSearchInputSchema
>;

export interface KnowledgeBaseSearchOutput {
  matchCount: number;
  matches: RipgrepMatch[];
  query: string;
  root: string;
  truncated: boolean;
}

interface KnowledgeBaseSearchOptions {
  workspaceRoot?: string;
}

export const knowledgeBaseSearchTool: ToolDefinition<
  KnowledgeBaseSearchInput,
  KnowledgeBaseSearchOutput
> = {
  description:
    "Search uploaded knowledge base documents for relevant facts. Does not search inherited URL sources such as Nakama documentation — use web_fetch on llms.txt and specific .md pages for product docs.",
  name: "knowledge_base_search",
  parallelSafe: true,
  parameters: jsonSchemaFromZod(knowledgeBaseSearchInputSchema),
  run(input, context) {
    return runKnowledgeBaseSearch(input, context);
  },
};

export async function runKnowledgeBaseSearch(
  input: unknown,
  context: ToolContext,
  options: KnowledgeBaseSearchOptions = {}
): Promise<KnowledgeBaseSearchOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!(orgId && profileId)) {
    throw new Error("orgId and profileId are required.");
  }

  const parsed = parseToolInput(knowledgeBaseSearchInputSchema, input);

  await ensureKnowledgeBaseDirs(orgId, profileId);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
  );
  const searchTarget = await resolveSearchTarget(
    orgId,
    profileId,
    parsed.filename ?? null
  );

  if (searchTarget.kind === "missing") {
    return {
      matchCount: 0,
      matches: [],
      query: parsed.query,
      root: searchTarget.root,
      truncated: false,
    };
  }

  const args = buildRipgrepArgs({
    glob: searchTarget.glob,
    maxResults: parsed.maxResults,
    query: parsed.query,
    regex: parsed.regex,
    searchRoot: searchTarget.root,
  });

  const searchResult = await runRipgrep(args, {
    maxResults: parsed.maxResults,
    searchRoot: searchTarget.root,
    workspaceRoot,
  });

  return {
    matchCount: searchResult.matches.length,
    matches: searchResult.matches,
    query: parsed.query,
    root: searchTarget.root,
    truncated: searchResult.truncated,
  };
}

type SearchTarget =
  | { kind: "dir"; root: string; glob: string }
  | { kind: "file"; root: string; glob: null }
  | { kind: "missing"; root: string };

async function resolveSearchTarget(
  orgId: string,
  profileId: string,
  filename: string | null
): Promise<SearchTarget> {
  const knowledgeBaseDir = getKnowledgeBaseDir(orgId, profileId);

  if (!filename) {
    return {
      glob: `*${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`,
      kind: "dir",
      root: knowledgeBaseDir,
    };
  }

  const documents = await listKnowledgeBaseDocuments(orgId, profileId);
  const normalized = filename.trim().toLowerCase();
  const document = documents.find(
    (entry) =>
      entry.filename.trim().toLowerCase() === normalized &&
      entry.status === "ready"
  );

  if (!document) {
    return { kind: "missing", root: knowledgeBaseDir };
  }

  return {
    glob: null,
    kind: "file",
    root: getKnowledgeBaseExtractedPath(orgId, profileId, document.id),
  };
}
