import { createRoute, z } from "@hono/zod-openapi";
import type { ServerOptions } from "../context";
import { requirePlatformAdminFromContext } from "../org-guards";
import { errorResponse, json } from "../shared";
import type { HonoApp } from "../types";

const auditEventSchema = z.object({
  action: z.string(),
  actorUserId: z.string().nullable(),
  createdAt: z.string(),
  id: z.string(),
  metadata: z.record(
    z.string(),
    z.union([z.boolean(), z.null(), z.number(), z.string()])
  ),
  orgId: z.string().nullable(),
  requestId: z.string().nullable(),
  resourceId: z.string().nullable(),
  resourceType: z.string(),
});

const listAuditEventsQuerySchema = z.object({
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  orgId: z.string().optional(),
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
          schema: z.object({ events: z.array(auditEventSchema) }),
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

    const events = await databaseAdapter.listAuditEvents(parsed.data);
    return json({ events });
  });
}
