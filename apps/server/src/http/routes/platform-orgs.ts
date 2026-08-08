import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  InviteOrgMemberRequest,
  ListOrganizationsResponse,
  OrganizationResponse,
  OrgInviteCreatedResponse,
  UpdateOrganizationRequest,
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
  const organizationSchema = z
    .object({})
    .passthrough()
    .openapi("CreateOrganizationResponse");
  const listOrganizationsSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrganizationsResponse");

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

    const body = await readJson<CreateOrganizationRequest>(c.req.raw);
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
              schema: z
                .object({ name: z.string() })
                .openapi("UpdateOrganizationRequest"),
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
    const body = await readJson<UpdateOrganizationRequest>(c.req.raw);
    const organization = await orgService.updateOrganization(orgId, body);
    return json<OrganizationResponse>({ organization });
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
              schema: z
                .object({
                  email: z.string(),
                  role: z.enum(["admin", "member", "viewer"]),
                })
                .openapi("InviteOrgMemberRequest"),
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
    const body = await readJson<InviteOrgMemberRequest>(c.req.raw);
    const invite = await orgService.createInvite({
      email: body.email,
      invitedByUserId: auth.user.id,
      orgId,
      role: body.role,
    });

    return json<OrgInviteCreatedResponse>(invite, 201);
  });
}
