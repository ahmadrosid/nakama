import { createRoute, z } from "@hono/zod-openapi";
import type {
  AssignMcpServerRequest,
  CreateMcpServerRequest,
  ListMcpServersResponse,
  McpServerResponse,
  ProfileResponse,
  TestMcpServerResponse,
  UpdateMcpServerRequest,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import {
  resolveCallbackBaseUrlFromRedirect,
  resolveComposioCallbackBaseUrl,
} from "../../services/composio-callback-url";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { errorResponse, json, oauthResultPage, readJson } from "../shared";
import type { HonoApp } from "../types";

/**
 * The OAuth provider redirects the operator's browser here, so this route is
 * public (see `isPublicRouteRequest`) and guarded by the single-use state it
 * carries. It has to be registered before the org-context middleware, which is
 * why it is not part of `registerMcpRoutes`.
 */
export function registerMcpOAuthRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { mcpService } = options;

  app.get("/v1/mcp/oauth/callback/:serverId", async (c) => {
    const providerError =
      c.req.query("error_description") || c.req.query("error");

    if (providerError) {
      return mcpOAuthPage("Authorization failed", providerError, 400);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!(code && state)) {
      return errorResponse("Missing OAuth code or state.", 400);
    }

    try {
      const { server } = await mcpService.completeOAuth(
        decodeURIComponent(c.req.param("serverId")),
        {
          callbackBaseUrl: resolveCallbackBaseUrlFromRedirect(c.req.raw),
          code,
          state,
        }
      );

      return mcpOAuthPage(
        `${server.name} connected`,
        `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"} cached. You can close this tab.`
      );
    } catch (error) {
      return mcpOAuthPage(
        "Authorization failed",
        error instanceof Error ? error.message : String(error),
        error instanceof NakamaApiError ? error.status : 400
      );
    }
  });
}

function mcpOAuthPage(title: string, detail: string, status = 200): Response {
  return oauthResultPage(
    title,
    detail,
    { href: "/system?tab=mcp", label: "Open MCP servers" },
    status
  );
}

export function registerMcpRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, mcpService } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const serverIdParam = z.object({
    serverId: z.string().openapi({ param: { in: "path", name: "serverId" } }),
  });
  const profileServerParams = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
    serverId: z.string().openapi({ param: { in: "path", name: "serverId" } }),
  });
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const listServersSchema = z
    .object({})
    .passthrough()
    .openapi("ListMcpServersResponse");
  const serverSchema = z.object({}).passthrough().openapi("McpServerResponse");
  const testServerSchema = z
    .object({})
    .passthrough()
    .openapi("TestMcpServerResponse");
  const createServerSchema = z
    .object({})
    .passthrough()
    .openapi("CreateMcpServerRequest");
  const updateServerSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateMcpServerRequest");
  const assignServerSchema = z
    .object({})
    .passthrough()
    .openapi("AssignMcpServerRequest");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listMcpServers",
      path: "/v1/mcp/servers",
      responses: {
        200: {
          content: { "application/json": { schema: listServersSchema } },
          description: "MCP server list",
        },
      },
      summary: "List MCP servers",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createMcpServer",
      path: "/v1/mcp/servers",
      request: {
        body: {
          content: { "application/json": { schema: createServerSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: serverSchema } },
          description: "MCP server created",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Create an MCP server",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "testMcpServer",
      path: "/v1/mcp/servers/test",
      request: {
        body: {
          content: { "application/json": { schema: createServerSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: testServerSchema } },
          description: "MCP test result",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Test an MCP server connection",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getMcpServer",
      path: "/v1/mcp/servers/{serverId}",
      request: { params: serverIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: serverSchema } },
          description: "MCP server detail",
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
      summary: "Get an MCP server",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "updateMcpServer",
      path: "/v1/mcp/servers/{serverId}",
      request: {
        body: {
          content: { "application/json": { schema: updateServerSchema } },
          required: true,
        },
        params: serverIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: serverSchema } },
          description: "MCP server updated",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update an MCP server",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteMcpServer",
      path: "/v1/mcp/servers/{serverId}",
      request: { params: serverIdParam },
      responses: {
        204: { description: "MCP server deleted" },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "MCP server in use by profiles",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete an MCP server",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "connectMcpServer",
      path: "/v1/mcp/servers/{serverId}/connect",
      request: { params: serverIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: serverSchema } },
          description: "MCP server connected",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Connect an MCP server",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "syncMcpServer",
      path: "/v1/mcp/servers/{serverId}/sync",
      request: { params: serverIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: serverSchema } },
          description: "MCP server synced",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Sync tools from an MCP server",
      tags: ["MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "assignMcpServerToProfile",
      path: "/v1/profiles/{profileId}/mcp-servers",
      request: {
        body: {
          content: { "application/json": { schema: assignServerSchema } },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "MCP server assigned",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Assign an MCP server to a profile",
      tags: ["Profiles", "MCP"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "unassignMcpServerFromProfile",
      path: "/v1/profiles/{profileId}/mcp-servers/{serverId}",
      request: { params: profileServerParams },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "MCP server unassigned",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Unassign an MCP server from a profile",
      tags: ["Profiles", "MCP"],
    })
  );

  app.get("/v1/mcp/servers", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ListMcpServersResponse>(await mcpService.listServers());
  });

  app.post("/v1/mcp/servers", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateMcpServerRequest>(c.req.raw);
    return json<McpServerResponse>(
      await mcpService.createServer(body, {
        callbackBaseUrl: resolveComposioCallbackBaseUrl({ request: c.req.raw }),
      }),
      201
    );
  });

  app.post("/v1/mcp/servers/test", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateMcpServerRequest>(c.req.raw);
    return json<TestMcpServerResponse>(
      await mcpService.testServer(body.transport, body.config, body.serverId)
    );
  });

  app.post("/v1/mcp/servers/:serverId/connect", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<McpServerResponse>(
      await mcpService.connectServer(
        decodeURIComponent(c.req.param("serverId")),
        {
          callbackBaseUrl: resolveComposioCallbackBaseUrl({
            request: c.req.raw,
          }),
        }
      )
    );
  });

  app.post("/v1/mcp/servers/:serverId/sync", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<McpServerResponse>(
      await mcpService.syncServer(decodeURIComponent(c.req.param("serverId")), {
        callbackBaseUrl: resolveComposioCallbackBaseUrl({ request: c.req.raw }),
      })
    );
  });

  app.get("/v1/mcp/servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<McpServerResponse>(
      await mcpService.getServer(decodeURIComponent(c.req.param("serverId")))
    );
  });

  app.patch("/v1/mcp/servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<UpdateMcpServerRequest>(c.req.raw);
    return json<McpServerResponse>(
      await mcpService.updateServer(
        decodeURIComponent(c.req.param("serverId")),
        body
      )
    );
  });

  app.delete("/v1/mcp/servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    await mcpService.deleteServer(decodeURIComponent(c.req.param("serverId")));
    return new Response(null, { status: 204 });
  });

  app.post("/v1/profiles/:profileId/mcp-servers", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<AssignMcpServerRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.assignMcpServer(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        body,
        { actorUserId: auth.user.id, source: "dashboard" }
      )
    );
  });

  app.delete("/v1/profiles/:profileId/mcp-servers/:serverId", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<ProfileResponse>(
      await agent.unassignMcpServer(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("serverId")),
        { actorUserId: auth.user.id, source: "dashboard" }
      )
    );
  });
}
