import { createRoute, z } from "@hono/zod-openapi";
import type {
  AddOrgMemberRequest,
  AddOrgMemberResponse,
  InviteOrgMemberRequest,
  ListOrgMembersResponse,
  OrgInviteCreatedResponse,
  OrgMemberResponse,
  UpdateOrgMemberRoleRequest,
} from "@tinyclaw/core/contract";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { errorResponse, json, readJson } from "../shared";
import { requireOrgAdminFromContext } from "../org-guards";

export function registerOrgMemberRoutes(app: HonoApp, options: ServerOptions): void {
  const { orgService } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { name: "orgId", in: "path" } }),
  });
  const addOrgMemberSchema = z
    .object({
      name: z.string(),
      email: z.string(),
      phone: z.string(),
      role: z.enum(["admin", "member", "viewer"]),
    })
    .openapi("AddOrgMemberRequest");
  const inviteOrgMemberSchema = z
    .object({
      email: z.string(),
      role: z.enum(["admin", "member", "viewer"]),
    })
    .openapi("InviteOrgMemberRequest");
  const addOrgMemberResponseSchema = z.object({}).passthrough().openapi("AddOrgMemberResponse");
  const orgInviteCreatedSchema = z.object({}).passthrough().openapi("OrgInviteCreatedResponse");
  const listOrgMembersResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrgMembersResponse");
  const orgMemberResponseSchema = z.object({}).passthrough().openapi("OrgMemberResponse");
  const updateOrgMemberRoleSchema = z
    .object({
      role: z.enum(["admin", "member", "viewer"]),
    })
    .openapi("UpdateOrgMemberRoleRequest");
  const orgMemberParams = orgIdParam.extend({
    userId: z.string().openapi({ param: { name: "userId", in: "path" } }),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/members",
      tags: ["Organizations"],
      summary: "Add a member with a generated temporary password",
      operationId: "addOrgMember",
      request: {
        params: orgIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: addOrgMemberSchema } },
        },
      },
      responses: {
        201: {
          description: "Member added",
          content: { "application/json": { schema: addOrgMemberResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      orgId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      role: body.role,
    });

    return json<AddOrgMemberResponse>(member, 201);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/invites",
      tags: ["Organizations"],
      summary: "Invite a user to an organization",
      operationId: "inviteOrgMember",
      request: {
        params: orgIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: inviteOrgMemberSchema } },
        },
      },
      responses: {
        201: {
          description: "Invite created",
          content: { "application/json": { schema: orgInviteCreatedSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      orgId,
      email: body.email,
      role: body.role,
      invitedByUserId: auth.user.id,
    });

    return json<OrgInviteCreatedResponse>(invite, 201);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/orgs/{orgId}/members",
      tags: ["Organizations"],
      summary: "List organization members",
      operationId: "listOrgMembers",
      request: { params: orgIdParam },
      responses: {
        200: {
          description: "Members listed",
          content: { "application/json": { schema: listOrgMembersResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      path: "/v1/orgs/{orgId}/members/{userId}",
      tags: ["Organizations"],
      summary: "Change a member role",
      operationId: "updateOrgMemberRole",
      request: {
        params: orgMemberParams,
        body: {
          required: true,
          content: { "application/json": { schema: updateOrgMemberRoleSchema } },
        },
      },
      responses: {
        200: {
          description: "Member updated",
          content: { "application/json": { schema: orgMemberResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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

    const body = await readJson<UpdateOrgMemberRoleRequest>(c.req.raw);
    const member = await orgService.updateMemberRole(orgId, userId, body.role);
    return json<OrgMemberResponse>(member);
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      path: "/v1/orgs/{orgId}/members/{userId}",
      tags: ["Organizations"],
      summary: "Remove a member from an organization",
      operationId: "removeOrgMember",
      request: { params: orgMemberParams },
      responses: {
        204: { description: "Member removed" },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
}
