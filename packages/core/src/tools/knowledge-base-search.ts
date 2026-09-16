import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getOrgKnowledgeBaseDir,
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
  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
  );
  const organizationTarget = await resolveOrganizationSearchTarget(
    orgId,
    profileId,
    parsed.filename ?? null
  );
  const organizationResult = await runSearchTarget(
    organizationTarget,
    parsed,
    workspaceRoot
  );

  if (backend) {
    // The memory backend indexes profile documents only, so attached
    // organization documents always come from the ripgrep pass and are merged
    // in whenever the backend answers.
    const matches = [
      ...backend.matches.map((match) => ({
        ...match,
        scope: "profile" as const,
      })),
      ...organizationResult.matches,
    ].slice(0, parsed.maxResults);
    return {
      matchCount: matches.length,
      matches,
      query: parsed.query,
      root: getKnowledgeBaseDir(orgId, profileId),
      truncated:
        backend.truncated ||
        organizationResult.truncated ||
        matches.length >= parsed.maxResults,
    };
  }

  await ensureKnowledgeBaseDirs(orgId, profileId);
  const profileResult = await runSearchTarget(
    await resolveProfileSearchTarget(orgId, profileId, parsed.filename ?? null),
    parsed,
    workspaceRoot
  );
  const matches = [
    ...profileResult.matches,
    ...organizationResult.matches,
  ].slice(0, parsed.maxResults);
  return {
    matchCount: matches.length,
    matches,
    query: parsed.query,
    root: getKnowledgeBaseDir(orgId, profileId),
    truncated:
      profileResult.truncated ||
      organizationResult.truncated ||
      matches.length >= parsed.maxResults,
  };
}

type SearchTarget =
  | { kind: "dir"; root: string; glob: string; scope: KnowledgeBaseScope }
  | { kind: "file"; root: string; glob: null; scope: KnowledgeBaseScope }
  | { kind: "missing"; root: string; scope: KnowledgeBaseScope };

async function resolveProfileSearchTarget(
  orgId: string,
  profileId: string,
  filename: string | null
): Promise<SearchTarget> {
  return pickSearchTarget(
    getKnowledgeBaseDir(orgId, profileId),
    "profile",
    await listKnowledgeBaseDocuments(orgId, profileId),
    filename
  );
}

async function resolveOrganizationSearchTarget(
  orgId: string,
  profileId: string,
  filename: string | null
): Promise<SearchTarget> {
  const root = getOrgKnowledgeBaseDir(orgId);
  const [sharedDocumentIds, organizationDocuments] = await Promise.all([
    getProfileSharedDocumentIds(orgId, profileId),
    listOrganizationKnowledgeBaseDocuments(orgId),
  ]);
  // Guard against stale profile references: never search the organization root
  // when no currently listed organization document is attached to this profile.
  const attached = organizationDocuments.filter((document) =>
    sharedDocumentIds.includes(document.id)
  );
  if (attached.length === 0) {
    return { kind: "missing", root, scope: "organization" };
  }
  return pickSearchTarget(root, "organization", attached, filename);
}

function pickSearchTarget(
  root: string,
  scope: KnowledgeBaseScope,
  documents: { filename: string; id: string; status: string }[],
  filename: string | null
): SearchTarget {
  if (!filename) {
    const ids = documents
      .filter((document) => document.status === "ready")
      .map((document) => document.id);
    if (ids.length === 0) {
      return { kind: "missing", root, scope };
    }
    return {
      glob:
        ids.length === 1
          ? `${ids[0]}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
          : `{${ids.map((id) => `${id}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`).join(",")}}`,
      kind: "dir",
      root,
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
    return { kind: "missing", root, scope };
  }
  return {
    glob: null,
    kind: "file",
    root: getKnowledgeBaseExtractedPath(root, document.id),
    scope,
  };
}

async function runSearchTarget(
  target: SearchTarget,
  parsed: KnowledgeBaseSearchInput,
  workspaceRoot: string
): Promise<{ matches: ScopedMatch[]; truncated: boolean }> {
  if (target.kind === "missing") {
    return { matches: [], truncated: false };
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
}
