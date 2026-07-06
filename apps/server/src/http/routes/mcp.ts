import { createRoute, z } from "@hono/zod-openapi";
import type {
  AssignMcpServerRequest,
  ListMcpServersResponse,
  McpServerResponse,
  ProfileResponse,
  TestMcpServerResponse,
  UpdateMcpServerRequest,
  CreateMcpServerRequest,
} from "@nakama/core";
import { json, readJson } from "../shared";
import { requirePlatformAdminFromContext, requireActiveOrgIdFromContext } from "../org-guards";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";

export function registerMcpRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, mcpService } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const serverIdParam = z.object({
    serverId: z.string().openapi({ param: { name: "serverId", in: "path" } }),
  });
  const profileServerParams = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
    serverId: z.string().openapi({ param: { name: "serverId", in: "path" } }),
  });
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
  });
  const listServersSchema = z.object({}).passthrough().openapi("ListMcpServersResponse");
  const serverSchema = z.object({}).passthrough().openapi("McpServerResponse");
  const testServerSchema = z.object({}).passthrough().openapi("TestMcpServerResponse");
  const createServerSchema = z.object({}).passthrough().openapi("CreateMcpServerRequest");
  const updateServerSchema = z.object({}).passthrough().openapi("UpdateMcpServerRequest");
  const assignServerSchema = z.object({}).passthrough().openapi("AssignMcpServerRequest");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");

  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/mcp/servers",
    tags: ["MCP"],
    summary: "List MCP servers",
    operationId: "listMcpServers",
    responses: { 200: { description: "MCP server list", content: { "application/json": { schema: listServersSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/mcp/servers",
    tags: ["MCP"],
    summary: "Create an MCP server",
    operationId: "createMcpServer",
    request: { body: { required: true, content: { "application/json": { schema: createServerSchema } } } },
    responses: {
      201: { description: "MCP server created", content: { "application/json": { schema: serverSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/mcp/servers/test",
    tags: ["MCP"],
    summary: "Test an MCP server connection",
    operationId: "testMcpServer",
    request: { body: { required: true, content: { "application/json": { schema: createServerSchema } } } },
    responses: {
      200: { description: "MCP test result", content: { "application/json": { schema: testServerSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/mcp/servers/{serverId}",
    tags: ["MCP"],
    summary: "Get an MCP server",
    operationId: "getMcpServer",
    request: { params: serverIdParam },
    responses: {
      200: { description: "MCP server detail", content: { "application/json": { schema: serverSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "patch",
    path: "/v1/mcp/servers/{serverId}",
    tags: ["MCP"],
    summary: "Update an MCP server",
    operationId: "updateMcpServer",
    request: { params: serverIdParam, body: { required: true, content: { "application/json": { schema: updateServerSchema } } } },
    responses: {
      200: { description: "MCP server updated", content: { "application/json": { schema: serverSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/mcp/servers/{serverId}",
    tags: ["MCP"],
    summary: "Delete an MCP server",
    operationId: "deleteMcpServer",
    request: { params: serverIdParam },
    responses: {
      204: { description: "MCP server deleted" },
      409: { description: "MCP server in use by profiles", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/mcp/servers/{serverId}/connect",
    tags: ["MCP"],
    summary: "Connect an MCP server",
    operationId: "connectMcpServer",
    request: { params: serverIdParam },
    responses: {
      200: { description: "MCP server connected", content: { "application/json": { schema: serverSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/mcp/servers/{serverId}/sync",
    tags: ["MCP"],
    summary: "Sync tools from an MCP server",
    operationId: "syncMcpServer",
    request: { params: serverIdParam },
    responses: {
      200: { description: "MCP server synced", content: { "application/json": { schema: serverSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/profiles/{profileId}/mcp-servers",
    tags: ["Profiles", "MCP"],
    summary: "Assign an MCP server to a profile",
    operationId: "assignMcpServerToProfile",
    request: { params: profileIdParam, body: { required: true, content: { "application/json": { schema: assignServerSchema } } } },
    responses: {
      200: { description: "MCP server assigned", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}/mcp-servers/{serverId}",
    tags: ["Profiles", "MCP"],
    summary: "Unassign an MCP server from a profile",
    operationId: "unassignMcpServerFromProfile",
    request: { params: profileServerParams },
    responses: {
      200: { description: "MCP server unassigned", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.get("/v1/mcp/servers", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ListMcpServersResponse>(await mcpService.listServers());
  });

  app.post("/v1/mcp/servers", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateMcpServerRequest>(c.req.raw);
    return json<McpServerResponse>(await mcpService.createServer(body), 201);
  });

  app.post("/v1/mcp/servers/test", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateMcpServerRequest>(c.req.raw);
    return json<TestMcpServerResponse>(
      await mcpService.testServer(body.transport, body.config, body.serverId),
    );
  });

  app.post("/v1/mcp/servers/:serverId/connect", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<McpServerResponse>(
      await mcpService.connectServer(decodeURIComponent(c.req.param("serverId"))),
    );
  });

  app.post("/v1/mcp/servers/:serverId/sync", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<McpServerResponse>(
      await mcpService.syncServer(decodeURIComponent(c.req.param("serverId"))),
    );
  });

  app.get("/v1/mcp/servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<McpServerResponse>(
      await mcpService.getServer(decodeURIComponent(c.req.param("serverId"))),
    );
  });

  app.patch("/v1/mcp/servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<UpdateMcpServerRequest>(c.req.raw);
    return json<McpServerResponse>(
      await mcpService.updateServer(decodeURIComponent(c.req.param("serverId")), body),
    );
  });

  app.delete("/v1/mcp/servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    await mcpService.deleteServer(decodeURIComponent(c.req.param("serverId")));
    return new Response(null, { status: 204 });
  });

  app.post("/v1/profiles/:profileId/mcp-servers", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<AssignMcpServerRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.assignMcpServer(orgId, decodeURIComponent(c.req.param("profileId")), body),
    );
  });

  app.delete("/v1/profiles/:profileId/mcp-servers/:serverId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<ProfileResponse>(
      await agent.unassignMcpServer(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("serverId")),
      ),
    );
  });
}
