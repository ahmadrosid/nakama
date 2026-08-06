import {
  type OrgRole,
  type ToolContext,
  type ToolDefinition,
  emptyObjectSchema,
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
 * undefined role (no user context) also blocks — callers that genuinely act
 * with member privileges (automation/task/sub-agent runners) pass an explicit
 * `orgRole: "member"` in the tool context.
 */
function requireOrgMemoryAccess(context: ToolContext): { orgId: string; role: OrgRole } {
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

export function createOrgMemoryTools(service: OrgMemoryService): ToolDefinition[] {
  return [
    {
      name: "org_memory_search",
      description:
        "Search the organization's shared memory (pinned facts, recent dated log, and archives) for facts relevant to the query. Use this when the injected org memory summary is missing detail or when you need the full history.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for across org memory bullets.",
          },
        },
        required: ["query"],
        additionalProperties: false,
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
      name: "org_memory_list",
      description:
        "List the organization's live org memory markdown (pinned and recent-log sections). Returns the current MEMORY.md content.",
      parameters: emptyObjectSchema(),
      async run(_input, context: ToolContext) {
        const { orgId } = requireOrgMemoryAccess(context);
        const content = await service.getMemory(orgId);
        return { content };
      },
    },
    {
      name: "propose_org_memory",
      description:
        "Propose a durable org-wide fact (team conventions, policies, shared context) for admin approval. Never propose secrets, credentials, API keys, tokens, or PII. Facts require admin approval before appearing in org memory. Do not re-propose if the tool reports the fact is already pending, pinned, or in the recent log.",
      parameters: {
        type: "object",
        properties: {
          bullet: {
            type: "string",
            description: "A single concise org-wide fact to propose for admin review.",
          },
        },
        required: ["bullet"],
        additionalProperties: false,
      },
      parallelSafe: false,
      async run(input, context: ToolContext) {
        const { orgId } = requireOrgMemoryAccess(context);
        const bullet = readString(input, "bullet");
        if (!bullet) {
          throw new Error("bullet is required.");
        }
        return service.propose(orgId, {
          bullet,
          profileId: context.profileId ?? null,
          sessionId: context.sessionId ?? null,
          proposedByUserId: context.userId ?? null,
        });
      },
    },
  ];
}
