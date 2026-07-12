import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  KNOWLEDGE_BASE_EXTRACTED_SUFFIX,
} from "../knowledge-base/paths";
import { ensureKnowledgeBaseDirs, listKnowledgeBaseDocuments } from "../knowledge-base/store";
import { getProfileSoulDir } from "../soul/resolve";
import { buildRipgrepArgs, runRipgrep, type RipgrepMatch } from "./ripgrep";
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
    query: requiredTrimmedString("query"),
    filename: trimmedOptionalString,
    regex: optionalRegexFlag,
    maxResults: maxResultsSchema,
  })
  .strict();

export type KnowledgeBaseSearchInput = z.infer<typeof knowledgeBaseSearchInputSchema>;

export interface KnowledgeBaseSearchMatch extends RipgrepMatch {}

export interface KnowledgeBaseSearchOutput {
  query: string;
  root: string;
  matches: KnowledgeBaseSearchMatch[];
  matchCount: number;
  truncated: boolean;
}

interface KnowledgeBaseSearchOptions {
  workspaceRoot?: string;
}

export const knowledgeBaseSearchTool: ToolDefinition<
  KnowledgeBaseSearchInput,
  KnowledgeBaseSearchOutput
> = {
  name: "knowledge_base_search",
  description:
    "Search uploaded knowledge base documents for relevant facts. Does not search inherited URL sources such as Nakama documentation — use web_fetch on llms.txt and specific .md pages for product docs.",
  parameters: jsonSchemaFromZod(knowledgeBaseSearchInputSchema),
  run(input, context) {
    return runKnowledgeBaseSearch(input, context);
  },
};

export async function runKnowledgeBaseSearch(
  input: unknown,
  context: ToolContext,
  options: KnowledgeBaseSearchOptions = {},
): Promise<KnowledgeBaseSearchOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!orgId || !profileId) {
    throw new Error("orgId and profileId are required.");
  }

  const parsed = parseToolInput(knowledgeBaseSearchInputSchema, input);

  await ensureKnowledgeBaseDirs(orgId, profileId);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId),
  );
  const searchTarget = await resolveSearchTarget(orgId, profileId, parsed.filename ?? null);

  if (searchTarget.kind === "missing") {
    return {
      query: parsed.query,
      root: searchTarget.root,
      matches: [],
      matchCount: 0,
      truncated: false,
    };
  }

  const args = buildRipgrepArgs({
    query: parsed.query,
    searchRoot: searchTarget.root,
    glob: searchTarget.glob,
    regex: parsed.regex,
    maxResults: parsed.maxResults,
  });

  const searchResult = await runRipgrep(args, {
    workspaceRoot,
    searchRoot: searchTarget.root,
    maxResults: parsed.maxResults,
  });

  return {
    query: parsed.query,
    root: searchTarget.root,
    matches: searchResult.matches,
    matchCount: searchResult.matches.length,
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
  filename: string | null,
): Promise<SearchTarget> {
  const knowledgeBaseDir = getKnowledgeBaseDir(orgId, profileId);

  if (!filename) {
    return { kind: "dir", root: knowledgeBaseDir, glob: `*${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}` };
  }

  const documents = await listKnowledgeBaseDocuments(orgId, profileId);
  const normalized = filename.trim().toLowerCase();
  const document = documents.find(
    (entry) => entry.filename.trim().toLowerCase() === normalized && entry.status === "ready",
  );

  if (!document) {
    return { kind: "missing", root: knowledgeBaseDir };
  }

  return {
    kind: "file",
    root: getKnowledgeBaseExtractedPath(orgId, profileId, document.id),
    glob: null,
  };
}

async function resolveWorkspaceRoot(rawWorkspaceRoot: string): Promise<string> {
  try {
    return await realpath(rawWorkspaceRoot);
  } catch {
    return path.resolve(rawWorkspaceRoot);
  }
}
