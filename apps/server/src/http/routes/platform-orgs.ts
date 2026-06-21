import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  ListOrganizationsResponse,
  InviteOrgMemberRequest,
  OrgInviteCreatedResponse,
} from "@tinyclaw/core/contract";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { errorResponse, json, readJson } from "../shared";
import { requirePlatformAdminFromContext } from "../org-guards";

export function registerPlatformOrgRoutes(app: HonoApp, options: ServerOptions): void {
  const { orgService } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const createOrganizationSchema = z
    .object({
      name: z.string(),
      slug: z.string(),
      admin: z
        .object({
          name: z.string(),
          email: z.string(),
          phone: z.string(),
        })
        .optional(),
    })
    .openapi("CreateOrganizationRequest");
  const organizationSchema = z.object({}).passthrough().openapi("CreateOrganizationResponse");
  const listOrganizationsSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrganizationsResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/platform/orgs",
      tags: ["Platform"],
      summary: "List organizations",
      operationId: "listPlatformOrganizations",
      responses: {
        200: {
          description: "Organization list",
          content: { "application/json": { schema: listOrganizationsSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/platform/orgs",
      tags: ["Platform"],
      summary: "Create an organization",
      operationId: "createPlatformOrganization",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: createOrganizationSchema } },
        },
      },
      responses: {
        201: {
          description: "Organization created",
          content: { "application/json": { schema: organizationSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      method: "post",
      path: "/v1/platform/orgs/{orgId}/invites",
      tags: ["Platform"],
      summary: "Invite a user to an organization",
      operationId: "createPlatformOrganizationInvite",
      request: {
        params: z.object({
          orgId: z.string().openapi({ param: { name: "orgId", in: "path" } }),
        }),
        body: {
          required: true,
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
        },
      },
      responses: {
        201: {
          description: "Invite created",
          content: {
            "application/json": {
              schema: z.object({}).passthrough().openapi("OrgInviteCreatedResponse"),
            },
          },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/platform/orgs/:orgId/invites", async (c) => {
    const auth = requirePlatformAdminFromContext(c);

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));
    const body = await readJson<InviteOrgMemberRequest>(c.req.raw);
    const invite = await orgService.createInvite({
      orgId,
      email: body.email,
      role: body.role,
      invitedByUserId: auth.user.id,
    });

    return json<OrgInviteCreatedResponse>(invite, 201);
  });
}
