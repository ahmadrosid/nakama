import { Database } from "bun:sqlite";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";
import { createChatLock } from "../channel-chat-lock";
import type {
  PublishedKnowledgeBaseDocument,
  ToolContext,
  ToolDefinition,
} from "../contract";
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
import { getOrgConfigDir } from "../user-config";
import { guardFilePath, resolveWorkspaceRoot } from "./paths";
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

export type KnowledgeBaseSearchInput = z.input<
  typeof knowledgeBaseSearchInputSchema
>;

type KnowledgeBaseScope = "organization" | "profile" | "parent";

type ScopedMatch = RipgrepMatch & {
  scope: KnowledgeBaseScope;
  publicationId?: string;
  sourceOrganization?: PublishedKnowledgeBaseDocument["sourceOrganization"];
};

const searchIndexLock = createChatLock();

const SEARCH_INDEX_FILE = ".kb-search.sqlite";

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
    "Search uploaded knowledge base documents for relevant facts. Includes profile documents, organization documents attached to this profile, and published parent documents available to this team. Parent results identify their publication and source organization. Does not search inherited URL sources such as Nakama documentation — use web_fetch on llms.txt and specific .md pages for product docs. When the result carries `unreadable`, those documents are attached but hold no searchable text, so report them as unreadable instead of telling the user nothing covers the topic.",
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

  // The backend, workspace, and document targets are independent reads.
  const [
    backend,
    workspaceRoot,
    organizationTarget,
    profileTarget,
    parentTarget,
  ] = await Promise.all([
    context.searchKnowledge?.({
      ...parsed,
      regex: parsed.regex,
    }),
    resolveWorkspaceRoot(
      options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
    ),
    resolveOrganizationSearchTarget(orgId, profileId, parsed.filename ?? null),
    resolveProfileSearchTarget(orgId, profileId, parsed.filename ?? null),
    resolveParentSearchTarget(context, parsed.filename ?? null),
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

    const sharedResults = parsed.regex
      ? await Promise.all(
          [organizationTarget, parentTarget].map((target) =>
            runSearchTarget(
              target,
              parsed,
              target.kind === "file" ? dirname(target.root) : target.root
            )
          )
        )
      : await runLexicalSearchTargets(
          getKnowledgeBaseDir(orgId, profileId),
          [organizationTarget, parentTarget],
          parsed,
          workspaceRoot
        );

    const merged = mergeScopedMatches(
      profileMatches,
      sharedResults.flatMap((result) => result.matches),
      parsed.maxResults
    );

    return {
      matchCount: merged.matches.length,
      matches: merged.matches,
      query: parsed.query,
      root: getKnowledgeBaseDir(orgId, profileId),
      truncated:
        backend.truncated ||
        sharedResults.some((result) => result.truncated) ||
        merged.dropped,
      ...unreadableField,
    };
  }

  await ensureKnowledgeBaseDirs(orgId, profileId);

  const [profileResult, organizationResult, parentResult] = parsed.regex
    ? await Promise.all([
        runSearchTarget(profileTarget, parsed, workspaceRoot),
        runSearchTarget(organizationTarget, parsed, organizationRoot),
        runSearchTarget(
          parentTarget,
          parsed,
          parentTarget.kind === "file"
            ? dirname(parentTarget.root)
            : parentTarget.root
        ),
      ])
    : await runLexicalSearchTargets(
        getKnowledgeBaseDir(orgId, profileId),
        [profileTarget, organizationTarget, parentTarget],
        parsed,
        workspaceRoot
      );

  const merged = mergeScopedMatches(
    profileResult.matches,
    [...organizationResult.matches, ...parentResult.matches],
    parsed.maxResults
  );

  return {
    matchCount: merged.matches.length,
    matches: merged.matches,
    query: parsed.query,
    root: getKnowledgeBaseDir(orgId, profileId),
    truncated:
      profileResult.truncated ||
      organizationResult.truncated ||
      parentResult.truncated ||
      merged.dropped,
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

type SearchTarget = {
  unreadable: string[];
  publishedDocuments?: PublishedKnowledgeBaseDocument[];
} & (
  | { kind: "dir"; root: string; globs: string[]; scope: KnowledgeBaseScope }
  | { kind: "file"; root: string; globs: null; scope: KnowledgeBaseScope }
  | { kind: "missing"; root: string; scope: KnowledgeBaseScope }
);

async function resolveParentSearchTarget(
  context: ToolContext,
  filename: string | null
): Promise<SearchTarget> {
  const documents = (await context.listPublishedKnowledgeDocuments?.()) ?? [];

  if (!documents.length) {
    return { kind: "missing", root: "", scope: "parent", unreadable: [] };
  }

  const sourceOrgId = documents[0]!.sourceOrganization.id;

  if (
    documents.some((document) => document.sourceOrganization.id !== sourceOrgId)
  ) {
    throw new Error("Published knowledge must have one source organization.");
  }

  const root = getOrgKnowledgeBaseDir(sourceOrgId);
  await guardFilePath(root, null, undefined, {
    allowedDirs: [getOrgConfigDir(sourceOrgId)],
  });

  for (const document of documents) {
    await guardFilePath(
      getKnowledgeBaseExtractedPath(root, document.id),
      null,
      undefined,
      { allowedDirs: [root] }
    );
  }

  return {
    ...pickSearchTarget(root, "parent", documents, filename),
    publishedDocuments: documents,
  };
}

function scopeSearchMatch(
  target: SearchTarget,
  match: RipgrepMatch
): ScopedMatch[] {
  if (target.scope !== "parent") {
    return [{ ...match, scope: target.scope }];
  }

  const document = target.publishedDocuments?.find(
    (entry) =>
      basename(match.file) === `${entry.id}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
  );

  if (!document) {
    return [];
  }

  return [
    {
      ...match,
      publicationId: document.publicationId,
      scope: "parent",
      sourceOrganization: document.sourceOrganization,
    },
  ];
}

async function resolveProfileSearchTarget(
  orgId: string,
  profileId: string,
  filename: string | null
): Promise<SearchTarget> {
  return pickSearchTarget(
    getKnowledgeBaseDir(orgId, profileId),
    "profile",
    await listKnowledgeBaseDocuments(orgId, profileId),
    filename,
    // Pages the knowledge-base-wiki skill compiles from these documents. The
    // leading **/ is needed: ripgrep matches a glob holding a slash against the
    // absolute path, and Bun.Glob.scan drops brace sets that hold one.
    ["**/wiki/*.md"]
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
  filename: string | null,
  extraGlobs: string[] = []
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
      globs: [
        ids.length === 1
          ? `${ids[0]}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
          : `{${ids.map((id) => `${id}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`).join(",")}}`,
        ...extraGlobs,
      ],
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
    globs: null,
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
  parsed: z.output<typeof knowledgeBaseSearchInputSchema>,
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
      glob: target.globs,
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
    matches: result.matches
      .slice(0, maxResults)
      .flatMap((match) => scopeSearchMatch(target, match)),
    truncated: result.truncated || result.matches.length > maxResults,
  };
}

async function runLexicalSearchTargets(
  profileRoot: string,
  targets: SearchTarget[],
  parsed: z.output<typeof knowledgeBaseSearchInputSchema>,
  workspaceRoot: string
): Promise<{ matches: ScopedMatch[]; truncated: boolean }[]> {
  if (parsed.maxResults <= 0) {
    return targets.map(() => ({ matches: [], truncated: false }));
  }

  // Filename filters change which files a target covers, so index and query share a lock.
  return searchIndexLock.withLock(profileRoot, async () => {
    await ensureDir(profileRoot);
    const canonicalProfileRoot = await realpath(profileRoot);

    const db = new Database(join(canonicalProfileRoot, SEARCH_INDEX_FILE), {
      create: true,
    });

    try {
      db.exec("PRAGMA synchronous = EXTRA");
      db.run(
        "CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, collection TEXT NOT NULL, path TEXT NOT NULL, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, UNIQUE (collection, path))"
      );

      db.run(
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(body, tokenize='porter unicode61')"
      );

      const ftsQuery = buildFtsQuery(parsed.query);

      return await Promise.all(
        targets.map(async (target) => {
          if (target.kind === "missing") {
            removeCollection(db, target.scope);

            return { matches: [], truncated: false };
          }

          const root =
            target.kind === "file" ? dirname(target.root) : target.root;

          if (target.scope === "parent") {
            removeCollection(db, target.scope);
          }

          const patterns =
            target.kind === "file" ? [basename(target.root)] : target.globs;

          const paths = await syncCollection(db, target.scope, root, patterns);

          if (!ftsQuery || paths.length === 0) {
            return { matches: [], truncated: false };
          }

          const rows = db
            .query<{ path: string }, [string, string, string, number]>(
              `SELECT d.path AS path
               FROM docs_fts
               JOIN docs d ON d.id = docs_fts.rowid
               WHERE docs_fts MATCH ?
                 AND d.collection = ?
                 AND d.path IN (SELECT value FROM json_each(?))
               ORDER BY bm25(docs_fts)
               LIMIT ?`
            )
            .all(
              ftsQuery,
              target.scope,
              JSON.stringify(paths),
              parsed.maxResults + 1
            );

          const matches = await Promise.all(
            rows.slice(0, parsed.maxResults).map(async (row) => {
              const body = await Bun.file(join(root, row.path)).text();
              const snippet = extractSnippet(body, parsed.query, 16_000);

              return scopeSearchMatch(target, {
                file:
                  target.scope === "profile"
                    ? relative(
                        workspaceRoot,
                        join(canonicalProfileRoot, row.path)
                      )
                    : row.path,
                line: snippet.line,
                text: snippet.text,
              });
            })
          );

          return {
            matches: matches.flat(),
            truncated: rows.length > parsed.maxResults,
          };
        })
      );
    } finally {
      // Finalize prepared statements so Windows releases the index file.
      db.close(true);
    }
  });
}

function removeCollection(db: Database, collection: string): void {
  db.run(
    "DELETE FROM docs_fts WHERE rowid IN (SELECT id FROM docs WHERE collection = ?)",
    [collection]
  );
  db.run("DELETE FROM docs WHERE collection = ?", [collection]);
}

/**
 * Brings the index up to date for the files `patterns` match under `root` and
 * returns their relative paths. Rows for files that no longer exist are
 * dropped; rows for files outside this pattern stay, so alternating filename
 * filters do not rebuild the index.
 */
async function syncCollection(
  db: Database,
  collection: string,
  root: string,
  patterns: string[]
): Promise<string[]> {
  const paths: string[] = [];

  for (const pattern of patterns) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root })) {
      paths.push(path);
    }
  }

  const known = new Map(
    db
      .query<
        { id: number; mtime_ms: number; path: string; size: number },
        [string]
      >("SELECT id, path, mtime_ms, size FROM docs WHERE collection = ?")
      .all(collection)
      .map((row) => [row.path, row])
  );

  const remove = (id: number) => {
    db.run("DELETE FROM docs_fts WHERE rowid = ?", [id]);
    db.run("DELETE FROM docs WHERE id = ?", [id]);
  };

  const scanned = new Set(paths);

  for (const [path, row] of known) {
    if (!(scanned.has(path) || (await Bun.file(join(root, path)).exists()))) {
      remove(row.id);
    }
  }

  for (const path of paths) {
    const file = Bun.file(join(root, path));
    const previous = known.get(path);

    if (
      previous &&
      previous.mtime_ms === file.lastModified &&
      previous.size === file.size
    ) {
      continue;
    }

    const body = await file.text();

    if (previous) {
      remove(previous.id);
    }

    const { lastInsertRowid } = db.run(
      "INSERT INTO docs (collection, path, mtime_ms, size) VALUES (?, ?, ?, ?)",
      [collection, path, file.lastModified, file.size]
    );

    db.run("INSERT INTO docs_fts (rowid, body) VALUES (?, ?)", [
      lastInsertRowid,
      body,
    ]);
  }

  return paths;
}

/**
 * Turns free text into an FTS5 query: every term must match, plain words match
 * as prefixes, quoted phrases and hyphenated or dotted tokens (`gpt-4`,
 * `3.14.0`) match as phrases, and a leading `-` excludes a term. Returns null
 * when nothing searchable is left.
 */
function buildFtsQuery(query: string): string | null {
  const positive: string[] = [];
  const negative: string[] = [];

  for (const match of query.matchAll(/(-?)(?:"([^"]*)"|(\S+))/gu)) {
    const negated = match[1] === "-" || (match[3]?.startsWith("-") ?? false);
    const text = match[2] ?? match[3]?.replace(/^-/u, "") ?? "";
    const parts = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

    if (parts.length === 0) {
      continue;
    }

    const isPhrase = match[2] !== undefined || parts.length > 1;
    const term = isPhrase ? `"${parts.join(" ")}"` : `"${parts[0]}"*`;
    (negated ? negative : positive).push(term);
  }

  if (positive.length === 0) {
    return null;
  }

  return [positive.join(" AND "), ...negative].join(" NOT ");
}

interface SnippetResult {
  line: number;
  text: string;
}

/** Finds the line that matches the most query terms and returns it with context. */
function extractSnippet(
  body: string,
  query: string,
  maxLength: number
): SnippetResult {
  const lines = body.split("\n");

  const terms = query
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => term.replace(/^-|"/gu, ""))
    .filter(Boolean);

  let bestLine = 0;
  let bestScore = -1;

  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    const score = terms.filter((term) => lower.includes(term)).length;

    if (score > bestScore) {
      bestLine = index;
      bestScore = score;
    }
  }

  const start = Math.max(0, bestLine - 1);
  const snippetLines = lines.slice(start, bestLine + 3);
  const text = snippetLines.join("\n");
  const header = `@@ -${start + 1},${snippetLines.length} @@ (${start} before, ${Math.max(0, lines.length - start - snippetLines.length)} after)`;

  return {
    line: bestLine + 1,
    text: `${header}\n${text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text}`,
  };
}
