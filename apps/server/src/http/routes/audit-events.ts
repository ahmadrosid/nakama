import { createRoute, z } from "@hono/zod-openapi";
import {
  AUDIT_EVENT_MAX_RETENTION_DAYS,
  AUDIT_EVENT_RETENTION_DAYS,
  mergeWorkspaceSettings,
} from "@nakama/db";
import type { Context } from "hono";
import type { ServerOptions } from "../context";
import {
  requireOrgAdminOrPlatformAdminFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { clientAddress } from "../rate-limit-middleware";
import { errorResponse, json, readJson } from "../shared";
import type { AppEnv, HonoApp } from "../types";

const auditEventSchema = z.object({
  action: z.string(),
  actorMode: z
    .enum(["agent", "anonymous", "session", "system", "token"])
    .nullable(),
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

  // Platform admins read the whole installation, or one org via `?orgId`.
  // Org admins read only their active org: the path org must match it, so a
  // member of one org cannot enumerate another's ledger (null answers 404,
  // which keeps existence opaque, like the sibling publication routes).
  const scopes = [
    [
      "/v1/platform/audit-events",
      (c: Context<AppEnv>): string | undefined => {
        requirePlatformAdminFromContext(c);

        return c.req.query("orgId") || undefined;
      },
    ],
    [
      "/v1/orgs/:orgId/audit-events",
      (c: Context<AppEnv>): string | null => {
        const auth = requireOrgAdminOrPlatformAdminFromContext(c);
        const orgId = decodeURIComponent(c.req.param("orgId") ?? "");

        return auth.activeOrgId === orgId ? orgId : null;
      },
    ],
  ] as const;

  for (const [path, scopeOf] of scopes) {
    app.get(path, async (c) => {
      const orgId = scopeOf(c);

      if (orgId === null) {
        return errorResponse("Not found", 404);
      }

      if (!options.databaseAdapter) {
        return errorResponse("Database not configured", 500);
      }

      const parsed = listAuditEventsQuerySchema.safeParse(c.req.query());

      if (!parsed.success) {
        return errorResponse("Invalid audit event query", 400);
      }

      return json(
        await options.databaseAdapter.listAuditEvents({ ...parsed.data, orgId })
      );
    });

    app.get(`${path}/stats`, async (c) => {
      const orgId = scopeOf(c);

      if (orgId === null) {
        return errorResponse("Not found", 404);
      }

      if (!options.databaseAdapter) {
        return errorResponse("Database not configured", 500);
      }

      const categories =
        await options.databaseAdapter.listAuditEventCategories(orgId);

      if (path === "/v1/platform/audit-events") {
        const settings = await options.databaseAdapter.getWorkspaceSettings();

        return json({
          categories,
          retentionDays:
            settings?.auditRetentionDays ?? AUDIT_EVENT_RETENTION_DAYS,
        });
      }

      return json({ categories });
    });
  }

  app.put("/v1/platform/audit-events/retention", async (c) => {
    requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const body = await readJson(
      c.req.raw,
      z
        .object({
          retentionDays: z
            .number()
            .int()
            .min(0)
            .max(AUDIT_EVENT_MAX_RETENTION_DAYS),
        })
        .strict()
    );

    const existing = await databaseAdapter.getWorkspaceSettings();
    await databaseAdapter.upsertWorkspaceSettings(
      mergeWorkspaceSettings(existing, {
        auditRetentionDays: body.retentionDays,
        updatedAt: new Date().toISOString(),
      })
    );

    return json({ retentionDays: body.retentionDays });
  });

  app.get("/v1/platform/audit-events/prunable", async (c) => {
    requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const rawDays = c.req.query("days");
    let days: number | undefined;

    if (rawDays !== undefined) {
      if (!/^\d+$/.test(rawDays)) {
        return errorResponse(
          `days must be an integer between 0 and ${AUDIT_EVENT_MAX_RETENTION_DAYS}`,
          400
        );
      }

      const parsedDays = Number(rawDays);

      if (
        !Number.isInteger(parsedDays) ||
        parsedDays < 0 ||
        parsedDays > AUDIT_EVENT_MAX_RETENTION_DAYS
      ) {
        return errorResponse(
          `days must be an integer between 0 and ${AUDIT_EVENT_MAX_RETENTION_DAYS}`,
          400
        );
      }

      days = parsedDays;
    }

    return json(await databaseAdapter.countPrunableAuditEvents(days));
  });

  app.post("/v1/platform/audit-events/prune", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const { databaseAdapter } = options;

    if (!databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const settings = await databaseAdapter.getWorkspaceSettings();

    const retentionDays =
      settings?.auditRetentionDays ?? AUDIT_EVENT_RETENTION_DAYS;

    if (retentionDays <= 0) {
      return errorResponse(
        "Audit retention is off (0 days); nothing to prune",
        400
      );
    }

    const result = await databaseAdapter.pruneAuditEvents({
      actorMode: auth.mode === "browser-session" ? "session" : "token",
      actorUserId: auth.user.id,
      clientIp: clientAddress(c, process.env.NAKAMA_TRUST_PROXY === "true"),
      forwardedFor: c.req.header("x-forwarded-for") ?? null,
      method: c.req.method,
      requestId: c.get("requestId") ?? null,
      route: c.req.path,
      sessionId: auth.session?.id ?? null,
      userAgent: c.req.header("user-agent")?.slice(0, 512) ?? null,
    });

    return json(result);
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
    const batches = databaseAdapter.exportAuditEvents();

    // One batch per pull, so a slow client holds at most one batch in memory
    // and an aborted download stops reading the table.
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await batches.next();

          if (done) {
            controller.close();

            return;
          }

          controller.enqueue(
            encoder.encode(
              value.map((event) => `${JSON.stringify(event)}\n`).join("")
            )
          );
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await batches.return();
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
