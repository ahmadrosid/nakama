import { createRoute, z } from "@hono/zod-openapi";
import type { ServerOptions } from "../context";
import {
  requireOrgAdminOrPlatformAdminFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { errorResponse, json } from "../shared";
import type { HonoApp } from "../types";

const auditEventSchema = z.object({
  action: z.string(),
  actorMode: z.enum(["agent", "session", "system", "token"]).nullable(),
  actorUserId: z.string().nullable(),
  clientIp: z.string().nullable(),
  createdAt: z.string(),
  forwardedFor: z.string().nullable(),
  hash: z.string().nullable(),
  id: z.string(),
  metadata: z.record(
    z.string(),
    z.union([z.boolean(), z.null(), z.number(), z.string()])
  ),
  method: z.string().nullable(),
  orgId: z.string().nullable(),
  outcome: z.enum(["success", "failure"]),
  prevHash: z.string().nullable(),
  requestId: z.string().nullable(),
  resourceId: z.string().nullable(),
  resourceType: z.string(),
  route: z.string().nullable(),
  seq: z.number().nullable(),
  sessionId: z.string().nullable(),
  status: z.number().nullable(),
  userAgent: z.string().nullable(),
});

const listAuditEventsQuerySchema = z.object({
  action: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  orgId: z.string().optional(),
  outcome: z.enum(["success", "failure"]).optional(),
  search: z.string().optional(),
});

const listAuditEventsRoute = createRoute({
  method: "get",
  operationId: "listAuditEvents",
  path: "/v1/platform/audit-events",
  request: {
    query: listAuditEventsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(auditEventSchema),
            total: z.number(),
          }),
        },
      },
      description: "Append-only security audit events",
    },
    400: {
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
      description: "Invalid query",
    },
    403: {
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
      description: "Platform admin access required",
    },
  },
  summary: "List security audit events",
  tags: ["Platform"],
});

export function registerAuditEventRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  app.openAPIRegistry.registerPath(listAuditEventsRoute);
  app.get("/v1/platform/audit-events", async (c) => {
    requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const parsed = listAuditEventsQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      return errorResponse("Invalid audit event query", 400);
    }

    const { events, total } = await databaseAdapter.listAuditEvents(
      parsed.data
    );

    return json({ events, total });
  });

  // Org-scoped reads for org admins. The path org must be the active org, so
  // a member of one org cannot enumerate another's ledger (404 keeps
  // existence opaque, like the sibling publication routes).
  app.get("/v1/orgs/:orgId/audit-events", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const parsed = listAuditEventsQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      return errorResponse("Invalid audit event query", 400);
    }

    const { events, total } = await databaseAdapter.listAuditEvents({
      ...parsed.data,
      orgId,
    });

    return json({ events, total });
  });

  app.get("/v1/orgs/:orgId/audit-events/stats", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    return json({
      categories: await databaseAdapter.listAuditEventCategories(orgId),
    });
  });

  app.get("/v1/platform/audit-events/stats", async (c) => {
    requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const query = listAuditEventsQuerySchema
      .pick({ orgId: true })
      .safeParse(c.req.query());

    const orgId = query.success ? query.data.orgId : undefined;

    return json({
      categories: await databaseAdapter.listAuditEventCategories(orgId),
    });
  });

  // The chain covers the whole installation, so integrity checks stay a
  // platform-admin capability.
  app.post("/v1/platform/audit-events/verify", async (c) => {
    requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    return json(await databaseAdapter.verifyAuditChain());
  });

  // NDJSON export, oldest first. The audit middleware records the export
  // itself (`audit.export`), so who downloaded the trail stays in the trail.
  app.get("/v1/platform/audit-events/export", async (c) => {
    requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const batch of databaseAdapter.exportAuditEvents()) {
            for (const event of batch) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            }
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-disposition": `attachment; filename="audit-${Date.now()}.jsonl"`,
        "content-type": "application/x-ndjson",
      },
    });
  });
}
