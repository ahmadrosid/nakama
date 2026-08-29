import { createRoute, z } from "@hono/zod-openapi";
import type {
  AddOrgMemberRequest,
  AddOrgMemberResponse,
  InviteOrgMemberRequest,
  ListOrgMembersResponse,
  OrgInviteCreatedResponse,
  OrgMemberResponse,
  UpdateOrgMemberRequest,
} from "@nakama/core/contract";
import { assertOrgMemberUserIdShape } from "../../services/org-service";
import type { ServerOptions } from "../context";
import { requireOrgAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
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
      role: z.enum(["admin", "member", "viewer"]),
    })
    .openapi("AddOrgMemberRequest");
  const inviteOrgMemberSchema = z
    .object({
      email: z.string(),
      role: z.enum(["admin", "member", "viewer"]),
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
      role: z.enum(["admin", "member", "viewer"]).optional(),
    })
    .openapi("UpdateOrgMemberRequest");
  const orgMemberParams = orgIdParam.extend({
    userId: z.string().openapi({ param: { in: "path", name: "userId" } }),
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

    const body = await readJson<AddOrgMemberRequest>(c.req.raw);
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

    const body = await readJson<InviteOrgMemberRequest>(c.req.raw);
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

    const body = await readJson<UpdateOrgMemberRequest>(c.req.raw);
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

    assertOrgMemberUserIdShape(userId);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    await orgService.removeMember(orgId, userId);
    return new Response(null, { status: 204 });
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
                .object({ name: z.string() })
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

    const body = await readJson<UpdateOrganizationRequest>(c.req.raw);
    const organization = await orgService.updateOrganization(orgId, body);
    return json<OrganizationResponse>({ organization });
  });
}
