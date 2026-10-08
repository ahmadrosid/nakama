import { Database } from "bun:sqlite";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";
import { createChatLock } from "../channel-chat-lock";
import type { ToolContext, ToolDefinition } from "../contract";
import { ensureDir } from "../fs";
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
  parseToolInput,
  requiredTrimmedString,
  trimmedOptionalString,
} from "./schema";

export const knowledgeBaseSearchInputSchema = z
  .object({
    filename: trimmedOptionalString,
    maxResults: maxResultsSchema,
    query: requiredTrimmedString("query"),
    regex: z.boolean().default(false),
  })
  .strict();

export type KnowledgeBaseSearchInput = z.infer<
  typeof knowledgeBaseSearchInputSchema
>;

type KnowledgeBaseScope = "organization" | "profile";

type ScopedMatch = RipgrepMatch & { scope: KnowledgeBaseScope };

const qmdSearchLock = createChatLock();

export interface KnowledgeBaseSearchOutput {
  matchCount: number;
  matches: ScopedMatch[];
  query: string;
  root: string;
  truncated: boolean;
  /**
   * Documents that are attached but hold no searchable text, so no query can
   * ever reach them. Present only when there is at least one, so a healthy
   * knowledge base returns the shape it always did.
   */
  unreadable?: string[];
}

interface KnowledgeBaseSearchOptions {
  workspaceRoot?: string;
}

export const knowledgeBaseSearchTool: ToolDefinition<
  KnowledgeBaseSearchInput,
  KnowledgeBaseSearchOutput
> = {
  description:
    "Search uploaded knowledge base documents for relevant facts. Includes profile documents and organization documents attached to this profile. Does not search inherited URL sources such as Nakama documentation — use web_fetch on llms.txt and specific .md pages for product docs. When the result carries `unreadable`, those documents are attached but hold no searchable text, so report them as unreadable instead of telling the user nothing covers the topic.",
  name: "knowledge_base_search",
  parallelSafe: true,
  parameters: jsonSchemaFromZod(knowledgeBaseSearchInputSchema),
  run(input, context) {
    return runKnowledgeBaseSearch(input, context);
  },
};

export async function runKnowledgeBaseSearch(
  input: KnowledgeBaseSearchInput,
  context: ToolContext,
  options: KnowledgeBaseSearchOptions = {}
): Promise<KnowledgeBaseSearchOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!(orgId && profileId)) {
    throw new Error("orgId and profileId are required.");
  }

  const parsed = parseToolInput(knowledgeBaseSearchInputSchema, input);

  // The backend call, the profile root and the organization target are
  // independent reads, so they share one round of I/O.
  const [backend, workspaceRoot, organizationTarget, profileTarget] =
    await Promise.all([
      context.searchKnowledge?.({
        ...parsed,
        regex: parsed.regex,
      }),
      resolveWorkspaceRoot(
        options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
      ),
      resolveOrganizationSearchTarget(
        orgId,
        profileId,
        parsed.filename ?? null
      ),
      resolveProfileSearchTarget(orgId, profileId, parsed.filename ?? null),
    ]);

  const unreadable = [
    ...profileTarget.unreadable,
    ...organizationTarget.unreadable,
  ];

  const unreadableField = unreadable.length > 0 ? { unreadable } : {};
  // Organization hits are relative to the organization root, not to the
  // profile workspace they used to be resolved against.
  const organizationRoot = organizationTarget.root;

  if (backend) {
    // The memory backend indexes profile documents only, so attached
    // organization documents still come from the local knowledge base index.
    const profileMatches = backend.matches.map((match) => ({
      ...match,
      scope: "profile" as const,
    }));

    const organizationResult = parsed.regex
      ? await runSearchTarget(organizationTarget, parsed, organizationRoot)
      : (
          await runQmdSearchTargets(
            getKnowledgeBaseDir(orgId, profileId),
            [organizationTarget],
            parsed,
            workspaceRoot
          )
        )[0]!;

    const merged = mergeScopedMatches(
      profileMatches,
      organizationResult.matches,
      parsed.maxResults
    );

    return {
      matchCount: merged.matches.length,
      matches: merged.matches,
      query: parsed.query,
      root: getKnowledgeBaseDir(orgId, profileId),
      truncated:
        backend.truncated || organizationResult.truncated || merged.dropped,
      ...unreadableField,
    };
  }

  await ensureKnowledgeBaseDirs(orgId, profileId);

  const [profileResult, organizationResult] = parsed.regex
    ? await Promise.all([
        runSearchTarget(profileTarget, parsed, workspaceRoot),
        runSearchTarget(organizationTarget, parsed, organizationRoot),
      ])
    : await runQmdSearchTargets(
        getKnowledgeBaseDir(orgId, profileId),
        [profileTarget, organizationTarget],
        parsed,
        workspaceRoot
      );

  const merged = mergeScopedMatches(
    profileResult.matches,
    organizationResult.matches,
    parsed.maxResults
  );

  return {
    matchCount: merged.matches.length,
    matches: merged.matches,
    query: parsed.query,
    root: getKnowledgeBaseDir(orgId, profileId),
    truncated:
      profileResult.truncated || organizationResult.truncated || merged.dropped,
    ...unreadableField,
  };
}

/**
 * Organization matches take their slots first: shared documents were attached on
 * purpose, so a profile search that fills `maxResults` on its own must not push
 * them out. Whatever the organization scope leaves goes to the profile scope.
 */
interface MergeScopedMatchesResult {
  dropped: boolean;
  matches: ScopedMatch[];
}

function mergeScopedMatches(
  profileMatches: ScopedMatch[],
  organizationMatches: ScopedMatch[],
  maxResults: number
): MergeScopedMatchesResult {
  const organizationKept = organizationMatches.slice(0, maxResults);
  const profileBudget = Math.max(0, maxResults - organizationKept.length);
  const profileKept = profileMatches.slice(0, profileBudget);

  return {
    dropped:
      profileKept.length < profileMatches.length ||
      organizationKept.length < organizationMatches.length,
    matches: [...profileKept, ...organizationKept],
  };
}

type SearchTarget = { unreadable: string[] } & (
  | { kind: "dir"; root: string; glob: string; scope: KnowledgeBaseScope }
  | { kind: "file"; root: string; glob: null; scope: KnowledgeBaseScope }
  | { kind: "missing"; root: string; scope: KnowledgeBaseScope }
);

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
    // Nothing of the organization is in scope for this profile, so it has no
    // unreadable documents to report either.
    return { kind: "missing", root, scope: "organization", unreadable: [] };
  }

  return pickSearchTarget(root, "organization", attached, filename);
}

function pickSearchTarget(
  root: string,
  scope: KnowledgeBaseScope,
  documents: { filename: string; id: string; status: string }[],
  filename: string | null
): SearchTarget {
  const unreadable = unreadableFilenames(documents, filename);

  if (!filename) {
    const ids = documents.flatMap((document) =>
      document.status === "ready" ? [document.id] : []
    );

    if (ids.length === 0) {
      return { kind: "missing", root, scope, unreadable };
    }

    return {
      glob:
        ids.length === 1
          ? `${ids[0]}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
          : `{${ids.map((id) => `${id}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`).join(",")}}`,
      kind: "dir",
      root,
      scope,
      unreadable,
    };
  }

  const normalized = filename.trim().toLowerCase();

  const document = documents.find(
    (entry) =>
      entry.filename.trim().toLowerCase() === normalized &&
      entry.status === "ready"
  );

  if (!document) {
    return { kind: "missing", root, scope, unreadable };
  }

  return {
    glob: null,
    kind: "file",
    root: getKnowledgeBaseExtractedPath(root, document.id),
    scope,
    unreadable,
  };
}

/**
 * A document whose extraction failed has no `.extracted.txt`, so every glob
 * below skips it and the caller sees exactly what it sees for a topic nobody
 * uploaded. Naming it is the difference between "we have nothing on this" and
 * "we have a document on this that could not be read".
 */
function unreadableFilenames(
  documents: { filename: string; status: string }[],
  filename: string | null
): string[] {
  if (!filename) {
    return documents.flatMap((document) =>
      document.status === "ready" ? [] : [document.filename]
    );
  }

  const normalized = filename.trim().toLowerCase();

  return documents.flatMap((document) =>
    document.status !== "ready" &&
    document.filename.trim().toLowerCase() === normalized
      ? [document.filename]
      : []
  );
}

async function runSearchTarget(
  target: SearchTarget,
  parsed: KnowledgeBaseSearchInput,
  relativeTo: string,
  maxResults = parsed.maxResults
): Promise<{ matches: ScopedMatch[]; truncated: boolean }> {
  if (target.kind === "missing" || maxResults <= 0) {
    return { matches: [], truncated: false };
  }

  // Ask for one match more than the budget so "exactly `maxResults` matches" is
  // only reported as truncated when a further match really exists.
  const probeLimit = maxResults + 1;

  const result = await runRipgrep(
    buildRipgrepArgs({
      glob: target.glob,
      maxResults: probeLimit,
      query: parsed.query,
      regex: parsed.regex,
      searchRoot: target.root,
    }),
    {
      maxResults: probeLimit,
      searchRoot: target.root,
      // Reported paths are relative to this target's own root: the profile
      // workspace for profile documents, the organization knowledge base for
      // shared ones.
      workspaceRoot: relativeTo,
    }
  );

  return {
    matches: result.matches.slice(0, maxResults).map((match) => ({
      ...match,
      scope: target.scope,
    })),
    truncated: result.truncated || result.matches.length > maxResults,
  };
}

async function runQmdSearchTargets(
  profileRoot: string,
  targets: SearchTarget[],
  parsed: KnowledgeBaseSearchInput,
  workspaceRoot: string
): Promise<{ matches: ScopedMatch[]; truncated: boolean }[]> {
  if (parsed.maxResults <= 0) {
    return targets.map(() => ({ matches: [], truncated: false }));
  }

  // Collection masks change with filename filters, so index and query share a lock.
  return qmdSearchLock.withLock(profileRoot, async () => {
    await ensureDir(profileRoot);
    const canonicalProfileRoot = await realpath(profileRoot);
    // Keep QMD's native packages out of the server and worker bundles.
    const qmdPackage = "@tobilu/qmd";

    // SAFETY: The constant package specifier is the declared @tobilu/qmd module.
    const { createStore, extractSnippet } = (await import(
      qmdPackage
    )) as typeof import("@tobilu/qmd");

    const store = await createStore({
      dbPath: join(canonicalProfileRoot, ".qmd.sqlite"),
    });

    try {
      const collectionNames: string[] = [];

      for (const target of targets) {
        if (target.kind === "missing") {
          await store.removeCollection(target.scope);
          continue;
        }

        const path =
          target.kind === "file" ? dirname(target.root) : target.root;

        const pattern =
          target.kind === "file" ? basename(target.root) : target.glob!;

        await store.addCollection(target.scope, { path, pattern });
        collectionNames.push(target.scope);
      }

      if (collectionNames.length === 0) {
        return targets.map(() => ({ matches: [], truncated: false }));
      }

      await store.update({ collections: collectionNames });

      return await Promise.all(
        targets.map(async (target) => {
          if (target.kind === "missing") {
            return { matches: [], truncated: false };
          }

          const results = await store.searchLex(parsed.query, {
            collection: target.scope,
            limit: parsed.maxResults + 1,
          });

          return {
            matches: results.slice(0, parsed.maxResults).map((result) => {
              const snippet = extractSnippet(
                result.body ?? "",
                parsed.query,
                16_000
              );

              const filename = basename(result.filepath);

              return {
                file:
                  target.scope === "profile"
                    ? relative(
                        workspaceRoot,
                        join(canonicalProfileRoot, filename)
                      )
                    : filename,
                line: snippet.line,
                scope: target.scope,
                text: snippet.snippet,
              };
            }),
            truncated: results.length > parsed.maxResults,
          };
        })
      );
    } finally {
      try {
        // Finalize prepared statements so Windows releases the index files.
        if (store.internal.db instanceof Database) {
          store.internal.db.close(true);
        }
      } finally {
        await store.close();
      }
    }
  });
}
