import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolDefinition } from "../contract";
import { getKnowledgeBaseExtractedDir, getKnowledgeBaseExtractedPath } from "../knowledge-base/paths";
import { ensureKnowledgeBaseDirs, listKnowledgeBaseDocuments } from "../knowledge-base/store";
import { getProfileSoulDir } from "../soul/resolve";
import {
  buildRipgrepArgs,
  readMaxResults,
  readOptionalBoolean,
  readOptionalString,
  readRequiredString,
  runRipgrep,
  type RipgrepMatch,
} from "./ripgrep";

export interface KnowledgeBaseSearchInput {
  query: string;
  filename?: string;
  regex?: boolean;
  maxResults?: number;
}

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
    "Search uploaded knowledge base documents for relevant facts. Use this for project data and reference docs instead of guessing or loading full files into context.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keyword or regex pattern to search for in knowledge base documents.",
      },
      filename: {
        type: "string",
        description:
          "Optional source filename filter (e.g. report.pdf) to narrow search to one document.",
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
    return runKnowledgeBaseSearch(input, context);
  },
};

export async function runKnowledgeBaseSearch(
  input: unknown,
  context: ToolContext,
  options: KnowledgeBaseSearchOptions = {},
): Promise<KnowledgeBaseSearchOutput> {
  const profileId = context.profileId?.trim();
  if (!profileId) {
    throw new Error("profileId is required.");
  }

  const query = readRequiredString(input, "query");
  const filename = readOptionalString(input, "filename");
  const regex = readOptionalBoolean(input, "regex") ?? true;
  const maxResults = readMaxResults(input);

  await ensureKnowledgeBaseDirs(profileId);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(profileId),
  );
  const searchTarget = await resolveSearchTarget(profileId, filename);

  if (searchTarget.kind === "missing") {
    return {
      query,
      root: searchTarget.root,
      matches: [],
      matchCount: 0,
      truncated: false,
    };
  }

  const args = buildRipgrepArgs({
    query,
    searchRoot: searchTarget.root,
    glob: searchTarget.glob,
    regex,
    maxResults,
  });

  const searchResult = await runRipgrep(args, {
    workspaceRoot,
    searchRoot: searchTarget.root,
    maxResults,
  });

  return {
    query,
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
  profileId: string,
  filename: string | null,
): Promise<SearchTarget> {
  const extractedDir = getKnowledgeBaseExtractedDir(profileId);

  if (!filename) {
    return { kind: "dir", root: extractedDir, glob: "*.txt" };
  }

  const documents = await listKnowledgeBaseDocuments(profileId);
  const normalized = filename.trim().toLowerCase();
  const document = documents.find(
    (entry) => entry.filename.trim().toLowerCase() === normalized && entry.status === "ready",
  );

  if (!document) {
    return { kind: "missing", root: extractedDir };
  }

  return {
    kind: "file",
    root: getKnowledgeBaseExtractedPath(profileId, document.id),
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
