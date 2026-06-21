import { createRoute, z } from "@hono/zod-openapi";
import type {
  AssignToolRequest,
  CreateToolRequest,
  ListToolsResponse,
  ProfileResponse,
  ToolResponse,
  ToolSourceResponse,
} from "@tinyclaw/core";
import { json, readJson } from "../shared";
import { requirePlatformAdminFromContext } from "../org-guards";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";

export function registerToolRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const toolIdParam = z.object({
    toolId: z.string().openapi({ param: { name: "toolId", in: "path" } }),
  });
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
  });
  const profileToolParams = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
    toolId: z.string().openapi({ param: { name: "toolId", in: "path" } }),
  });
  const listToolsSchema = z.object({}).passthrough().openapi("ListToolsResponse");
  const toolSchema = z.object({}).passthrough().openapi("ToolResponse");
  const createToolSchema = z.object({}).passthrough().openapi("CreateToolRequest");
  const createToolResponseSchema = z.object({}).passthrough().openapi("CreateToolResponse");
  const toolSourceSchema = z.object({}).passthrough().openapi("ToolSourceResponse");
  const assignToolSchema = z.object({}).passthrough().openapi("AssignToolRequest");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");

  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tools",
    tags: ["Tools"],
    summary: "List all tools",
    operationId: "listTools",
    responses: { 200: { description: "Tool list", content: { "application/json": { schema: listToolsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/tools",
    tags: ["Tools"],
    summary: "Register a tool",
    operationId: "createTool",
    request: { body: { required: true, content: { "application/json": { schema: createToolSchema } } } },
    responses: {
      201: { description: "Tool created", content: { "application/json": { schema: createToolResponseSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tools/{toolId}/source",
    tags: ["Tools"],
    summary: "Get tool source code",
    operationId: "getToolSource",
    request: { params: toolIdParam },
    responses: {
      200: { description: "Tool source", content: { "application/json": { schema: toolSourceSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tools/{toolId}",
    tags: ["Tools"],
    summary: "Get a tool",
    operationId: "getTool",
    request: { params: toolIdParam },
    responses: {
      200: { description: "Tool detail", content: { "application/json": { schema: toolSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/tools/{toolId}",
    tags: ["Tools"],
    summary: "Delete a registered tool",
    operationId: "deleteTool",
    request: { params: toolIdParam },
    responses: {
      204: { description: "Tool deleted" },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/tools",
    tags: ["Profiles", "Tools"],
    summary: "List tools assigned to a profile",
    operationId: "listProfileTools",
    request: { params: profileIdParam },
    responses: {
      200: { description: "Tool list", content: { "application/json": { schema: listToolsSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/profiles/{profileId}/tools",
    tags: ["Profiles", "Tools"],
    summary: "Assign a tool to a profile",
    operationId: "assignToolToProfile",
    request: { params: profileIdParam, body: { required: true, content: { "application/json": { schema: assignToolSchema } } } },
    responses: {
      200: { description: "Tool assigned", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}/tools/{toolId}",
    tags: ["Profiles", "Tools"],
    summary: "Unassign a tool from a profile",
    operationId: "unassignToolFromProfile",
    request: { params: profileToolParams },
    responses: {
      200: { description: "Tool unassigned", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.get("/v1/tools", async () => {
    return json<ListToolsResponse>(await agent.listTools());
  });

  app.post("/v1/tools", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateToolRequest>(c.req.raw);
    return json(await agent.createTool(body), 201);
  });

  app.get("/v1/tools/:toolId/source", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ToolSourceResponse>(
      await agent.getToolSource(decodeURIComponent(c.req.param("toolId"))),
    );
  });

  app.get("/v1/tools/:toolId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ToolResponse>(await agent.getTool(decodeURIComponent(c.req.param("toolId"))));
  });

  app.delete("/v1/tools/:toolId", async (c) => {
    requirePlatformAdminFromContext(c);
    await agent.deleteTool(decodeURIComponent(c.req.param("toolId")));
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId/tools", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ListToolsResponse>(
      await agent.listProfileTools(decodeURIComponent(c.req.param("profileId"))),
    );
  });

  app.post("/v1/profiles/:profileId/tools", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<AssignToolRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.assignTool(decodeURIComponent(c.req.param("profileId")), body),
    );
  });

  app.delete("/v1/profiles/:profileId/tools/:toolId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ProfileResponse>(
      await agent.unassignTool(
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("toolId")),
      ),
    );
  });
}
