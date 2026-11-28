import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateOrganizationResponse,
  ListOrganizationsResponse,
  OrganizationResponse,
  OrgInviteCreatedResponse,
  PlatformSessionStepsResponse,
} from "@nakama/core/contract";
import type { ServerOptions } from "../context";
import { requirePlatformAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerPlatformOrgRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { orgService } = options;

  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");

  const createOrganizationSchema = z
    .object({
      admin: z
        .object({
          email: z.string(),
          name: z.string(),
          phone: z.string(),
        })
        .optional(),
      name: z.string(),
      slug: z.string(),
    })
    .openapi("CreateOrganizationRequest");

  const updateOrganizationSchema = z
    .object({
      allowedInviteDomains: z.array(z.string()).optional(),
      memberApprovalRequired: z.boolean().optional(),
      monthlyLlmTokenLimit: z.number().int().min(0).optional(),
      monthlyLlmTurnLimit: z.number().int().min(0).optional(),
      monthlyLlmWarningPercent: z.number().int().min(1).max(99).optional(),
      name: z.string().optional(),
      skillsCuratorArchiveAfterDays: z.number().optional(),
      skillsCuratorConsolidateEnabled: z.boolean().optional(),
      skillsCuratorEnabled: z.boolean().optional(),
      skillsCuratorStaleAfterDays: z.number().optional(),
      skillsPostTurnReview: z.boolean().optional(),
      skillsWriteApproval: z.boolean().optional(),
    })
    .openapi("UpdateOrganizationRequest");

  const inviteOrgMemberSchema = z
    .object({
      email: z.string(),
      role: z.enum(["admin", "member"]),
    })
    .openapi("InviteOrgMemberRequest");

  const organizationSchema = z
    .object({})
    .passthrough()
    .openapi("CreateOrganizationResponse");

  const listOrganizationsSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrganizationsResponse");

  const platformSessionStepSchema = z
    .object({
      actor: z.enum(["agent", "user"]),
      completedAt: z.string(),
      id: z.number().int(),
      outcome: z.enum(["success", "error", "cancelled"]),
      startedAt: z.string(),
      toolName: z.string(),
    })
    .openapi("PlatformSessionStep");

  const platformSessionStepCursorSchema = z
    .object({ id: z.number().int(), startedAt: z.string() })
    .openapi("PlatformSessionStepCursor");

  const platformSessionStepsResponseSchema = z
    .object({
      next: platformSessionStepCursorSchema.nullable(),
      previous: platformSessionStepCursorSchema.nullable(),
      step: platformSessionStepSchema.nullable(),
    })
    .openapi("PlatformSessionStepsResponse");

  const sessionStepsQuerySchema = z.object({
    at: z.iso.datetime({ offset: true }).optional(),
    id: z.coerce.number().int().positive().optional(),
  });

  const platformSessionParamsSchema = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
    sessionId: z.string().openapi({ param: { in: "path", name: "sessionId" } }),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listPlatformOrganizations",
      path: "/v1/platform/orgs",
      responses: {
        200: {
          content: { "application/json": { schema: listOrganizationsSchema } },
          description: "Organization list",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List organizations",
      tags: ["Platform"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createPlatformOrganization",
      path: "/v1/platform/orgs",
      request: {
        body: {
          content: { "application/json": { schema: createOrganizationSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: organizationSchema } },
          description: "Organization created",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Create an organization",
      tags: ["Platform"],
    })
  );

  app.get("/v1/platform/orgs", async (c) => {
    requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const organizations = await orgService.listOrganizations();

    return json<ListOrganizationsResponse>({ organizations });
  });

  app.post("/v1/platform/orgs", async (c) => {
    const auth = requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, createOrganizationSchema);
    const result = await orgService.createOrganization(body, auth.user.id);

    return json<CreateOrganizationResponse>(result, 201);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "updatePlatformOrganization",
      path: "/v1/platform/orgs/{orgId}",
      request: {
        body: {
          content: {
            "application/json": {
              schema: updateOrganizationSchema,
            },
          },
          required: true,
        },
        params: z.object({
          orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({})
                .passthrough()
                .openapi("OrganizationResponse"),
            },
          },
          description: "Organization updated",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update an organization",
      tags: ["Platform"],
    })
  );

  app.patch("/v1/platform/orgs/:orgId", async (c) => {
    requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));
    const body = await readJson(c.req.raw, updateOrganizationSchema);
    const organization = await orgService.updateOrganization(orgId, body);

    return json<OrganizationResponse>({ organization });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "archivePlatformOrganization",
      path: "/v1/platform/orgs/{orgId}",
      request: {
        params: z.object({
          orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({})
                .passthrough()
                .openapi("OrganizationResponse"),
            },
          },
          description: "Organization archived",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Archive an organization",
      tags: ["Platform"],
    })
  );

  app.delete("/v1/platform/orgs/:orgId", async (c) => {
    const auth = requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));

    const organization = await orgService.archiveOrganization(
      orgId,
      auth.user.id
    );

    return json<OrganizationResponse>({ organization });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "permanentlyDeletePlatformOrganization",
      path: "/v1/platform/orgs/{orgId}/permanent",
      request: {
        params: z.object({
          orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
        }),
      },
      responses: {
        204: { description: "Organization permanently deleted" },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Permanently delete an archived organization",
      tags: ["Platform"],
    })
  );

  app.delete("/v1/platform/orgs/:orgId/permanent", async (c) => {
    requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));
    await orgService.permanentlyDeleteOrganization(orgId);

    return new Response(null, { status: 204 });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createPlatformOrganizationInvite",
      path: "/v1/platform/orgs/{orgId}/invites",
      request: {
        body: {
          content: {
            "application/json": {
              schema: inviteOrgMemberSchema,
            },
          },
          required: true,
        },
        params: z.object({
          orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
        }),
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: z
                .object({})
                .passthrough()
                .openapi("OrgInviteCreatedResponse"),
            },
          },
          description: "Invite created",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Invite a user to an organization",
      tags: ["Platform"],
    })
  );

  app.post("/v1/platform/orgs/:orgId/invites", async (c) => {
    const auth = requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));
    const body = await readJson(c.req.raw, inviteOrgMemberSchema);

    const invite = await orgService.createInvite({
      email: body.email,
      invitedByUserId: auth.user.id,
      orgId,
      role: body.role,
    });

    return json<OrgInviteCreatedResponse>(invite, 201);
  });

  const platformOrgMemberParams = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
    userId: z.string().openapi({ param: { in: "path", name: "userId" } }),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "disablePlatformOrgMember",
      path: "/v1/platform/orgs/{orgId}/members/{userId}/disable",
      request: { params: platformOrgMemberParams },
      responses: {
        204: { description: "Member disabled" },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Disable a user's account",
      tags: ["Platform"],
    })
  );

  app.post("/v1/platform/orgs/:orgId/members/:userId/disable", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));
    const userId = decodeURIComponent(c.req.param("userId"));

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    await orgService.disableMember(orgId, userId);

    return new Response(null, { status: 204 });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "enablePlatformOrgMember",
      path: "/v1/platform/orgs/{orgId}/members/{userId}/enable",
      request: { params: platformOrgMemberParams },
      responses: {
        204: { description: "Member enabled" },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Re-enable a disabled user's account",
      tags: ["Platform"],
    })
  );

  app.post("/v1/platform/orgs/:orgId/members/:userId/enable", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));
    const userId = decodeURIComponent(c.req.param("userId"));

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    await orgService.enableMember(orgId, userId);

    return new Response(null, { status: 204 });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "erasePlatformUser",
      path: "/v1/platform/users/{userId}",
      request: {
        params: z.object({
          userId: z.string().openapi({ param: { in: "path", name: "userId" } }),
        }),
      },
      responses: {
        204: { description: "User erased" },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Permanently erase a user account",
      tags: ["Platform"],
    })
  );

  app.delete("/v1/platform/users/:userId", async (c) => {
    const auth = requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const userId = decodeURIComponent(c.req.param("userId"));
    await orgService.eraseUser(userId, auth.user.id);

    return new Response(null, { status: 204 });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getPlatformSessionStepWindow",
      path: "/v1/platform/orgs/{orgId}/sessions/{sessionId}/steps",
      request: {
        params: platformSessionParamsSchema,
        query: sessionStepsQuerySchema,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: platformSessionStepsResponseSchema,
            },
          },
          description: "One recorded step and its chronological neighbours",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid query or step cursor",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Platform admin access required",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Session not found in this organization",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Read a recorded session tool step",
      tags: ["Platform"],
    })
  );

  app.get("/v1/platform/orgs/:orgId/sessions/:sessionId/steps", async (c) => {
    requirePlatformAdminFromContext(c);

    if (!options.databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const parsed = sessionStepsQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      return errorResponse("Invalid session step query", 400);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const stepId = parsed.data.id;

    // ISO with an offset becomes UTC, the form the append path stored.
    const at = parsed.data.at
      ? new Date(parsed.data.at).toISOString()
      : undefined;

    const window = await options.databaseAdapter.getSessionStepWindow(
      orgId,
      sessionId,
      { at, stepId }
    );

    if (!window) {
      return errorResponse("Not found", 404);
    }

    if (stepId !== undefined && !window.current) {
      return errorResponse("Invalid step cursor", 400);
    }

    const step = window.current;

    return json<PlatformSessionStepsResponse>({
      next: window.next,
      previous: window.previous,
      step: step
        ? {
            actor: step.actor,
            completedAt: step.completedAt,
            id: step.id,
            outcome: step.outcome,
            startedAt: step.startedAt,
            toolName: step.toolName,
          }
        : null,
    });
  });
}
