import {
  emptyObjectSchema,
  listKnowledgeBaseDocuments,
  type OrgRole,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import type { OrgMemoryService } from "../services/org-memory-service";

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();
  if (!orgId) {
    throw new Error("Organization context is required.");
  }
  return orgId;
}

/**
 * Deny-by-default role gate for org-memory tools. Viewers are blocked; an
 * undefined role (no user context) also blocks. Automation/task runners pass
 * an explicit `orgRole: "member"`; sub-agents inherit the parent role.
 */
function requireOrgMemoryAccess(context: ToolContext): {
  orgId: string;
  role: OrgRole;
} {
  const orgId = requireOrgId(context);
  const role = context.orgRole;
  if (role === undefined || role === null) {
    throw new Error("Org memory tools require an organization role.");
  }
  if (role === "viewer") {
    throw new Error("Viewers cannot access org memory.");
  }
  return { orgId, role };
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Agents usually see filenames in the KB catalog / search hits, not raw ids.
 * Accept either and store only ids that resolve to a real document.
 */
async function resolveSourceDocumentIds(
  orgId: string,
  profileId: string | null | undefined,
  raw: unknown
): Promise<string[] | undefined> {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  if (!profileId?.trim()) {
    return raw.filter((entry): entry is string => typeof entry === "string");
  }

  const documents = await listKnowledgeBaseDocuments(orgId, profileId);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const byFilename = new Map(
    documents.map((document) => [document.filename.toLowerCase(), document])
  );

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const key = entry.trim();
    if (!key) {
      continue;
    }
    const document = byId.get(key) ?? byFilename.get(key.toLowerCase()) ?? null;
    if (!document || seen.has(document.id)) {
      continue;
    }
    seen.add(document.id);
    resolved.push(document.id);
  }
  return resolved;
}

export function createOrgMemoryTools(
  service: OrgMemoryService
): ToolDefinition[] {
  return [
    {
      description:
        "Search the organization's shared memory (pinned facts, recent dated log, and archives) for facts relevant to the query. Use this when the injected org memory summary is missing detail or when you need the full history.",
      name: "org_memory_search",
      parameters: {
        additionalProperties: false,
        properties: {
          query: {
            description: "Text to search for across org memory bullets.",
            type: "string",
          },
        },
        required: ["query"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const { orgId } = requireOrgMemoryAccess(context);
        const query = readString(input, "query");
        if (!query) {
          throw new Error("query is required.");
        }
        return service.search(orgId, query);
      },
    },
    {
      description:
        "List the organization's live org memory markdown (pinned and recent-log sections). Returns the current MEMORY.md content.",
      name: "org_memory_list",
      parameters: emptyObjectSchema(),
      async run(_input, context: ToolContext) {
        const { orgId } = requireOrgMemoryAccess(context);
        const content = await service.getMemory(orgId);
        return { content };
      },
    },
    {
      description:
        "Propose a durable org-wide fact (team conventions, policies, shared context) for admin approval. Never propose secrets, credentials, API keys, tokens, or PII. Facts require admin approval before appearing in org memory. Do not re-propose if the tool reports the fact is already pending, pinned, or in the recent log. When the fact came from a knowledge-base document, pass its document id(s) or filename(s) in sourceDocumentIds.",
      name: "propose_org_memory",
      parallelSafe: false,
      parameters: {
        additionalProperties: false,
        properties: {
          bullet: {
            description:
              "A single concise org-wide fact to propose for admin review.",
            type: "string",
          },
          sourceDocumentIds: {
            description:
              "Optional knowledge-base document ids or filenames the fact was derived from. Pass these when the bullet summarizes or cites uploaded documents.",
            items: { type: "string" },
            type: "array",
          },
        },
        required: ["bullet"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const { orgId } = requireOrgMemoryAccess(context);
        const bullet = readString(input, "bullet");
        if (!bullet) {
          throw new Error("bullet is required.");
        }
        const rawSourceIds =
          typeof input === "object" &&
          input !== null &&
          "sourceDocumentIds" in input
            ? (input as Record<string, unknown>).sourceDocumentIds
            : undefined;
        return service.propose(orgId, {
          bullet,
          profileId: context.profileId ?? null,
          proposedByUserId: context.userId ?? null,
          sessionId: context.sessionId ?? null,
          sourceDocumentIds: await resolveSourceDocumentIds(
            orgId,
            context.profileId,
            rawSourceIds
          ),
        });
      },
    },
  ];
}
