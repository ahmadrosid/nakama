import { createRoute, z } from "@hono/zod-openapi";
import type {
  AddOrgMemberResponse,
  CreateOrganizationResponse,
  ListOrgMembersResponse,
  ListOrgSharedResourcesResponse,
  OrganizationOverviewResponse,
  OrganizationResponse,
  OrgInviteCreatedResponse,
  OrgLlmQuotaStatusResponse,
  OrgMemberResponse,
  OrgSharedResourceResponse,
  OrgUsageLeader,
  OrgUsageSummaryResponse,
  ProfileResponse,
} from "@nakama/core/contract";
import { OrgUsageQuotaService } from "../../services/org-usage-quota-service";
import type { ServerOptions } from "../context";
import {
  requireOrgAdminFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
  requireOrgMember,
  requireOrgMemberFromContext,
} from "../org-guards";
import { errorResponse, getRequestAuth, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerOrgMemberRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { orgService } = options;

  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");

  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
  });

  const addOrgMemberSchema = z
    .object({
      email: z.string(),
      name: z.string(),
      phone: z.string().optional(),
      role: z.enum(["admin", "member"]),
    })
    .openapi("AddOrgMemberRequest");

  const inviteOrgMemberSchema = z
    .object({
      email: z.string(),
      role: z.enum(["admin", "member"]),
    })
    .openapi("InviteOrgMemberRequest");

  const addOrgMemberResponseSchema = z
    .object({})
    .passthrough()
    .openapi("AddOrgMemberResponse");

  const orgInviteCreatedSchema = z
    .object({})
    .passthrough()
    .openapi("OrgInviteCreatedResponse");

  const listOrgMembersResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrgMembersResponse");

  const orgMemberResponseSchema = z
    .object({})
    .passthrough()
    .openapi("OrgMemberResponse");

  const updateOrgMemberSchema = z
    .object({
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      role: z.enum(["admin", "member"]).optional(),
    })
    .openapi("UpdateOrgMemberRequest");

  const updateOrganizationSchema = z
    .object({
      allowedInviteDomains: z.array(z.string()).optional(),
      monthlyLlmTokenLimit: z.number().optional(),
      monthlyLlmTurnLimit: z.number().optional(),
      monthlyLlmWarningPercent: z.number().optional(),
      name: z.string().optional(),
      skillsCuratorArchiveAfterDays: z.number().optional(),
      skillsCuratorConsolidateEnabled: z.boolean().optional(),
      skillsCuratorEnabled: z.boolean().optional(),
      skillsCuratorStaleAfterDays: z.number().optional(),
      skillsPostTurnReview: z.boolean().optional(),
      skillsWriteApproval: z.boolean().optional(),
    })
    .strict();

  const orgMemberParams = orgIdParam.extend({
    userId: z.string().openapi({ param: { in: "path", name: "userId" } }),
  });

  const resourceKindSchema = z.enum([
    "knowledge",
    "skill",
    "agent",
    "tool",
    "model",
  ]);

  const publishSharedResourceSchema = z
    .object({
      resourceId: z.string().trim().min(1),
      resourceKind: resourceKindSchema,
    })
    .strict()
    .openapi("PublishOrgSharedResourceRequest");

  const sharedResourceResponseSchema = z
    .object({
      publication: z.object({
        createdAt: z.string(),
        id: z.string(),
        orgId: z.string(),
        resourceId: z.string(),
        resourceKind: resourceKindSchema,
        updatedAt: z.string(),
      }),
    })
    .openapi("OrgSharedResourceResponse");

  const sharedResourceParams = orgIdParam.extend({
    publicationId: z
      .string()
      .openapi({ param: { in: "path", name: "publicationId" } }),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createSharedAgentInstance",
      path: "/v1/orgs/{orgId}/shared-agents/{publicationId}/instance",
      request: { params: sharedResourceParams },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({}).passthrough().openapi("ProfileResponse"),
            },
          },
          description: "Team agent instance created or recovered",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Agent invocation access required",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Organization or publication unavailable",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Template cannot be used by this team",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Instance setup failed; retry selection",
        },
      },
      summary: "Select a published agent in the active team",
      tags: ["Organizations"],
    })
  );
  app.post(
    "/v1/orgs/:orgId/shared-agents/:publicationId/instance",
    async (c) => {
      const auth = getRequestAuth(c);
      const orgId = decodeURIComponent(c.req.param("orgId"));

      if (auth.activeOrgId !== orgId) {
        return errorResponse("Not found", 404);
      }

      requireOrgMember(auth);

      if (!orgService) {
        return errorResponse("Organization service not configured", 500);
      }

      const profile = await orgService.createSharedAgentInstance(
        orgId,
        decodeURIComponent(c.req.param("publicationId")),
        auth.user.id
      );

      return json<ProfileResponse>(
        await options.agent.getProfile(orgId, profile.id)
      );
    }
  );

  const listSharedResourcesResponseSchema = z
    .object({
      resources: z.array(
        sharedResourceResponseSchema.shape.publication.extend({
          label: z.string(),
          readiness: z.enum(["ready", "requires_setup", "unavailable"]),
          sourceOrganization: z.object({ id: z.string(), name: z.string() }),
        })
      ),
    })
    .openapi("ListOrgSharedResourcesResponse");

  const organizationOverviewSchema = z
    .object({
      activeOrgId: z.string(),
      canManageOrganization: z.boolean(),
      organization: z.object({ id: z.string(), name: z.string() }),
      sharedResources: listSharedResourcesResponseSchema.shape.resources,
      teams: z.array(
        z.object({
          canSwitch: z.boolean(),
          id: z.string(),
          isCurrent: z.boolean(),
          localResourceCounts: z.object({
            agents: z.number().int().nonnegative(),
            knowledge: z.number().int().nonnegative(),
            skills: z.number().int().nonnegative(),
            tools: z.number().int().nonnegative(),
          }),
          memberCount: z.number().int().nonnegative(),
          name: z.string(),
          slug: z.string(),
        })
      ),
    })
    .openapi("OrganizationOverviewResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getOrganizationOverview",
      path: "/v1/orgs/{orgId}/overview",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: organizationOverviewSchema },
          },
          description: "Published resources and permitted team summaries",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Organization unavailable",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Overview failed",
        },
      },
      summary: "Read organization overview from active tenant context",
      tags: ["Organizations"],
    })
  );
  app.get("/v1/orgs/:orgId/overview", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    return json<OrganizationOverviewResponse>(
      await orgService.getOrganizationOverview(orgId, auth.user.id)
    );
  });
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listOrgSharedResources",
      path: "/v1/orgs/{orgId}/shared-resources",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: listSharedResourcesResponseSchema },
          },
          description: "Published parent resource summaries",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Organization unavailable",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Listing failed",
        },
      },
      summary: "List parent publications from active organization context",
      tags: ["Organizations"],
    })
  );
  app.get("/v1/orgs/:orgId/shared-resources", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    return json<ListOrgSharedResourcesResponse>(
      await orgService.listSharedResources(orgId, auth.user.id)
    );
  });
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "publishOrgSharedResource",
      path: "/v1/orgs/{orgId}/shared-resources",
      request: {
        body: {
          content: {
            "application/json": { schema: publishSharedResourceSchema },
          },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: sharedResourceResponseSchema },
          },
          description: "Resource published or recovered",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid request",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Access denied",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Source unavailable",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid template",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Publication failed",
        },
      },
      summary: "Publish a parent resource",
      tags: ["Organizations"],
    })
  );
  app.post("/v1/orgs/:orgId/shared-resources", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, publishSharedResourceSchema);

    const publication = await orgService.publishSharedResource(
      orgId,
      body,
      auth.user.id
    );

    return json<OrgSharedResourceResponse>({ publication }, 201);
  });
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "unpublishOrgSharedResource",
      path: "/v1/orgs/{orgId}/shared-resources/{publicationId}",
      request: { params: sharedResourceParams },
      responses: {
        204: { description: "Publication removed or already absent" },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Access denied",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Organization unavailable",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Parent context required",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Removal failed",
        },
      },
      summary: "Unpublish a parent resource",
      tags: ["Organizations"],
    })
  );
  app.delete("/v1/orgs/:orgId/shared-resources/:publicationId", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    await orgService.unpublishSharedResource(
      orgId,
      decodeURIComponent(c.req.param("publicationId")),
      auth.user.id
    );

    return new Response(null, { status: 204 });
  });

  const createTeamSchema = z
    .object({
      adminUserId: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      slug: z.string().trim().min(1),
    })
    .strict()
    .openapi("CreateTeamRequest");

  const createTeamResponseSchema = z
    .object({
      adminMember: z
        .object({
          member: z
            .object({
              userId: z.string(),
              role: z.enum(["admin", "member"]),
            })
            .passthrough(),
          temporaryPassword: z.string().nullable(),
        })
        .optional(),
      organization: z
        .object({
          createdAt: z.string(),
          id: z.string(),
          name: z.string(),
          parentOrgId: z.string().nullable().optional(),
          slug: z.string(),
          updatedAt: z.string(),
        })
        .passthrough(),
    })
    .openapi("CreateTeamResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createTeam",
      path: "/v1/orgs/{orgId}/teams",
      request: {
        body: {
          content: { "application/json": { schema: createTeamSchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        201: {
          content: { "application/json": { schema: createTeamResponseSchema } },
          description: "Team created or recovered",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid request",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Access denied",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Organization unavailable",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Request conflict",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Setup failed",
        },
      },
      summary: "Create a team with an existing first admin",
      tags: ["Organizations"],
    })
  );
  app.post("/v1/orgs/:orgId/teams", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, createTeamSchema);

    return json<CreateOrganizationResponse>(
      await orgService.createTeam(orgId, body, auth.user.id),
      201
    );
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "addOrgMember",
      path: "/v1/orgs/{orgId}/members",
      request: {
        body: {
          content: { "application/json": { schema: addOrgMemberSchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: addOrgMemberResponseSchema },
          },
          description: "Member added",
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
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Add a member with a generated temporary password",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/members", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, addOrgMemberSchema);

    const member = await orgService.addMember({
      email: body.email,
      name: body.name,
      orgId,
      phone: body.phone ?? "",
      role: body.role,
    });

    return json<AddOrgMemberResponse>(member, 201);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "inviteOrgMember",
      path: "/v1/orgs/{orgId}/invites",
      request: {
        body: {
          content: { "application/json": { schema: inviteOrgMemberSchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        201: {
          content: { "application/json": { schema: orgInviteCreatedSchema } },
          description: "Invite created",
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
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Invite a user to an organization",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/invites", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, inviteOrgMemberSchema);

    const invite = await orgService.createInvite({
      email: body.email,
      invitedByUserId: auth.user.id,
      orgId,
      role: body.role,
    });

    return json<OrgInviteCreatedResponse>(invite, 201);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listOrgMembers",
      path: "/v1/orgs/{orgId}/members",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: listOrgMembersResponseSchema },
          },
          description: "Members listed",
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
      summary: "List organization members",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/members", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    return json<ListOrgMembersResponse>(await orgService.listMembers(orgId));
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listParentOrgMembers",
      path: "/v1/orgs/{orgId}/parent-members",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: listOrgMembersResponseSchema },
          },
          description: "Parent members not yet in the team",
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
      summary: "List parent organization members available to add to a team",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/parent-members", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    return json<ListOrgMembersResponse>(
      await orgService.listParentMembers(orgId)
    );
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "updateOrgMember",
      path: "/v1/orgs/{orgId}/members/{userId}",
      request: {
        body: {
          content: { "application/json": { schema: updateOrgMemberSchema } },
          required: true,
        },
        params: orgMemberParams,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgMemberResponseSchema } },
          description: "Member updated",
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
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update a member profile or role",
      tags: ["Organizations"],
    })
  );

  app.patch("/v1/orgs/:orgId/members/:userId", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));
    const userId = decodeURIComponent(c.req.param("userId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, updateOrgMemberSchema);
    const member = await orgService.updateMember(orgId, userId, body);

    return json<OrgMemberResponse>(member);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "removeOrgMember",
      path: "/v1/orgs/{orgId}/members/{userId}",
      request: { params: orgMemberParams },
      responses: {
        204: { description: "Member removed" },
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
      summary: "Remove a member from an organization",
      tags: ["Organizations"],
    })
  );

  app.delete("/v1/orgs/:orgId/members/:userId", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));
    const userId = decodeURIComponent(c.req.param("userId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    await orgService.removeMember(orgId, userId);

    return new Response(null, { status: 204 });
  });

  app.get("/v1/orgs/:orgId/llm-quota", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!options.databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const quota = await new OrgUsageQuotaService(
      options.databaseAdapter
    ).getStatus(orgId);

    return json<OrgLlmQuotaStatusResponse>(quota);
  });

  app.get("/v1/orgs/:orgId/usage-summary", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const [daily, byActor, profiles, { members }] = await Promise.all([
      options.agent.getLlmUsageDailyStats(orgId),
      options.agent.getLlmUsageStatsByActor(orgId),
      options.databaseAdapter?.listProfilesForOrg(orgId) ?? [],
      orgService.listMembers(orgId),
    ]);
    const sumRequests = (days: typeof daily) =>
      days.reduce((total, day) => total + day.requestCount, 0);
    // Everyone is listed, so quiet people and agents show up with 0 calls.
    const rank = (
      roster: { id: string; name: string }[],
      groups: typeof byActor.agents
    ): OrgUsageLeader[] => {
      const counts = new Map(
        groups.map((group) => [group.id, group.requestCount])
      );

      return roster
        .map(({ id, name }) => ({ name, requestCount: counts.get(id) ?? 0 }))
        .sort((a, b) => b.requestCount - a.requestCount);
    };
    const agents = rank(
      profiles
        .filter((profile) => !profile.isSuper)
        .map((profile) => ({ id: profile.id, name: profile.name })),
      byActor.agents
    );
    const topAgent = agents.find((agent) => agent.requestCount > 0);

    return json<OrgUsageSummaryResponse>({
      agents,
      costUsd30d: daily.reduce((total, day) => total + day.estimatedCostUsd, 0),
      daily,
      people: rank(
        members.map((member) => ({
          id: member.userId,
          name: member.name?.trim() || member.email,
        })),
        byActor.users
      ),
      requests7d: sumRequests(daily.slice(-7)),
      requestsPrev7d: sumRequests(daily.slice(-14, -7)),
      topAgent: topAgent ?? null,
    });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "updateOrganization",
      path: "/v1/orgs/{orgId}",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z
                .object({
                  allowedInviteDomains: z.array(z.string()).optional(),
                  monthlyLlmTokenLimit: z.number().int().min(0).optional(),
                  monthlyLlmTurnLimit: z.number().int().min(0).optional(),
                  monthlyLlmWarningPercent: z
                    .number()
                    .int()
                    .min(1)
                    .max(99)
                    .optional(),
                  name: z.string().optional(),
                })
                .openapi("UpdateOrganizationRequest"),
            },
          },
          required: true,
        },
        params: orgIdParam,
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
      tags: ["Organizations"],
    })
  );

  app.patch("/v1/orgs/:orgId", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    if (auth.activeOrgId !== orgId) {
      return errorResponse("Not found", 404);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const body = await readJson(c.req.raw, updateOrganizationSchema);
    const organization = await orgService.updateOrganization(orgId, body);

    return json<OrganizationResponse>({ organization });
  });
}
