import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  KNOWLEDGE_BASE_EXTRACTED_SUFFIX,
} from "../knowledge-base/paths";
import {
  ensureKnowledgeBaseDirs,
  getProfileSharedDocumentIds,
  listKnowledgeBaseDocuments,
  listOrganizationKnowledgeBaseDocuments,
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

type KnowledgeBaseScope = "organization" | "profile";
type ScopedMatch = RipgrepMatch & { scope: KnowledgeBaseScope };

export interface KnowledgeBaseSearchOutput {
  matchCount: number;
  matches: ScopedMatch[];
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
    "Search uploaded knowledge base documents for relevant facts. Includes profile documents and organization documents attached to this profile. Does not search inherited URL sources such as Nakama documentation — use web_fetch on llms.txt and specific .md pages for product docs.",
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
  const backend = await context.searchKnowledge?.({
    ...parsed,
    regex: (input as { regex?: unknown }).regex === true,
  });
  if (backend) {
    return {
      ...backend,
      matchCount: backend.matches.length,
      matches: backend.matches.map((match) => ({ ...match, scope: "profile" })),
      query: parsed.query,
      root: getKnowledgeBaseDir(orgId, profileId),
    };
  }

  await ensureKnowledgeBaseDirs(orgId, profileId);
  const [sharedDocumentIds, organizationDocuments] = await Promise.all([
    getProfileSharedDocumentIds(orgId, profileId),
    listOrganizationKnowledgeBaseDocuments(orgId),
  ]);
  const targets = await Promise.all([
    resolveSearchTarget(
      orgId,
      profileId,
      parsed.filename ?? null,
      undefined,
      "profile"
    ),
    resolveSearchTarget(
      orgId,
      undefined,
      parsed.filename ?? null,
      new Set(sharedDocumentIds),
      "organization"
    ),
  ]);
  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
  );
  const selectedOrgDocumentIds = new Set(
    organizationDocuments
      .filter((document) => sharedDocumentIds.includes(document.id))
      .map((document) => document.id)
  );
  // Guard against stale profile references: never search an organization root when no
  // currently listed organization document is attached to this profile.
  if (selectedOrgDocumentIds.size === 0) {
    targets[1] = {
      kind: "missing",
      root: getKnowledgeBaseDir(orgId, undefined),
      scope: "organization",
    };
  }

  const results = await Promise.all(
    targets.map(async (target) => {
      if (target.kind === "missing") {
        return { matches: [] as ScopedMatch[], truncated: false };
      }
      const result = await runRipgrep(
        buildRipgrepArgs({
          glob: target.glob,
          maxResults: parsed.maxResults,
          query: parsed.query,
          regex: parsed.regex,
          searchRoot: target.root,
        }),
        {
          maxResults: parsed.maxResults,
          searchRoot: target.root,
          workspaceRoot,
        }
      );
      return {
        matches: result.matches.map((match) => ({
          ...match,
          scope: target.scope,
        })),
        truncated: result.truncated,
      };
    })
  );
  const matches = results
    .flatMap((result) => result.matches)
    .slice(0, parsed.maxResults);
  return {
    matchCount: matches.length,
    matches,
    query: parsed.query,
    root: getKnowledgeBaseDir(orgId, profileId),
    truncated:
      results.some((result) => result.truncated) ||
      matches.length >= parsed.maxResults,
  };
}

type SearchTarget =
  | { kind: "dir"; root: string; glob: string; scope: KnowledgeBaseScope }
  | { kind: "file"; root: string; glob: null; scope: KnowledgeBaseScope }
  | { kind: "missing"; root: string; scope: KnowledgeBaseScope };

async function resolveSearchTarget(
  orgId: string,
  profileId: string | undefined,
  filename: string | null,
  allowedDocumentIds: Set<string> | undefined,
  scope: KnowledgeBaseScope
): Promise<SearchTarget> {
  const knowledgeBaseDir = getKnowledgeBaseDir(orgId, profileId);
  const documents = (await listKnowledgeBaseDocuments(orgId, profileId)).filter(
    (document) => !allowedDocumentIds || allowedDocumentIds.has(document.id)
  );
  if (!filename) {
    const ids = documents
      .filter((document) => document.status === "ready")
      .map((document) => document.id);
    if (ids.length === 0) {
      return { kind: "missing", root: knowledgeBaseDir, scope };
    }
    return {
      glob:
        ids.length === 1
          ? `${ids[0]}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
          : `{${ids.map((id) => `${id}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`).join(",")}}`,
      kind: "dir",
      root: knowledgeBaseDir,
      scope,
    };
  }
  const normalized = filename.trim().toLowerCase();
  const document = documents.find(
    (entry) =>
      entry.filename.trim().toLowerCase() === normalized &&
      entry.status === "ready"
  );
  if (!document) {
    return { kind: "missing", root: knowledgeBaseDir, scope };
  }
  return {
    glob: null,
    kind: "file",
    root: getKnowledgeBaseExtractedPath(orgId, profileId, document.id),
    scope,
  };
}
