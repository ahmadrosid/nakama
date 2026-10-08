import {
  emptyObjectSchema,
  getProfileSharedDocumentIds,
  type JsonValue,
  type KnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  listOrganizationKnowledgeBaseDocuments,
  requireToolNotViewer,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { z } from "zod";
import type { OrgMemoryService } from "../services/org-memory-service";

/** The one org-memory tool that writes. Cognito sessions drop it. */
export const PROPOSE_ORG_MEMORY_TOOL_NAME = "propose_org_memory";

const OrgMemoryInputSchema = z.object({
  bullet: z.string().optional().catch(undefined),
  sourceDocumentIds: z.array(z.json()).optional().catch([]),
});

const OrgMemorySearchInputSchema = z.object({
  query: z.string().optional().catch(undefined),
});

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
function requireOrgMemoryAccess(context: ToolContext) {
  const orgId = requireOrgId(context);
  requireToolNotViewer(context);

  return { orgId };
}

function readBullet(
  input: z.infer<typeof OrgMemoryInputSchema>
): string | null {
  return input.bullet?.trim() || null;
}

/**
 * Agents usually see filenames in the KB catalog / search hits, not raw ids.
 * Accept either and store only ids that resolve to a real document. Attached
 * organization documents resolve too: the catalog lists them as searchable, so
 * a citation that names one must not be dropped here.
 */
async function resolveSourceDocumentIds(
  orgId: string,
  profileId: string | null | undefined,
  raw: JsonValue[] | undefined
): Promise<string[] | undefined> {
  if (raw === undefined) {
    return undefined;
  }

  if (!profileId?.trim()) {
    return raw.flatMap((entry) => z.string().safeParse(entry).data ?? []);
  }

  const [profileDocuments, sharedDocumentIds, organizationDocuments] =
    await Promise.all([
      listKnowledgeBaseDocuments(orgId, profileId),
      getProfileSharedDocumentIds(orgId, profileId),
      listOrganizationKnowledgeBaseDocuments(orgId),
    ]);

  const documents: KnowledgeBaseDocument[] = [
    ...profileDocuments,
    ...organizationDocuments.filter((document) =>
      sharedDocumentIds.includes(document.id)
    ),
  ];

  const byId = new Map<string, KnowledgeBaseDocument>();
  const byFilename = new Map<string, KnowledgeBaseDocument>();

  for (const document of documents) {
    byId.set(document.id, document);
    // Profile scope is listed first, so it wins a filename collision.
    const filename = document.filename.toLowerCase();

    if (!byFilename.has(filename)) {
      byFilename.set(filename, document);
    }
  }

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const parsedEntry = z.string().safeParse(entry);

    if (!parsedEntry.success) {
      continue;
    }

    const key = parsedEntry.data.trim();

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
        const parsedInput = OrgMemorySearchInputSchema.parse(input);
        const { orgId } = requireOrgMemoryAccess(context);
        const query = parsedInput.query?.trim();

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
      name: PROPOSE_ORG_MEMORY_TOOL_NAME,
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
        const parsedInput = OrgMemoryInputSchema.safeParse(input);
        const toolInput = parsedInput.success ? parsedInput.data : {};
        const { orgId } = requireOrgMemoryAccess(context);
        const bullet = readBullet(toolInput);

        if (!bullet) {
          throw new Error("bullet is required.");
        }

        return service.propose(orgId, {
          bullet,
          profileId: context.profileId ?? null,
          proposedByUserId: context.userId ?? null,
          sessionId: context.sessionId ?? null,
          sourceDocumentIds: await resolveSourceDocumentIds(
            orgId,
            context.profileId,
            toolInput.sourceDocumentIds
          ),
        });
      },
    },
  ];
}
