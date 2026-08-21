import { createRoute, z } from "@hono/zod-openapi";
import type {
  AssignToolRequest,
  CreateToolRequest,
  ListToolsResponse,
  ProfileResponse,
  RunToolRequest,
  RunToolResponse,
  SuggestToolParamsRequest,
  SuggestToolParamsResponse,
  ToolResponse,
  ToolSourceResponse,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerToolRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const toolIdParam = z.object({
    toolId: z.string().openapi({ param: { in: "path", name: "toolId" } }),
  });
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const profileToolParams = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
    toolId: z.string().openapi({ param: { in: "path", name: "toolId" } }),
  });
  const listToolsSchema = z
    .object({})
    .passthrough()
    .openapi("ListToolsResponse");
  const toolSchema = z.object({}).passthrough().openapi("ToolResponse");
  const createToolSchema = z
    .object({})
    .passthrough()
    .openapi("CreateToolRequest");
  const createToolResponseSchema = z
    .object({})
    .passthrough()
    .openapi("CreateToolResponse");
  const toolSourceSchema = z
    .object({})
    .passthrough()
    .openapi("ToolSourceResponse");
  const assignToolSchema = z
    .object({})
    .passthrough()
    .openapi("AssignToolRequest");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");
  const runToolSchema = z.object({}).passthrough().openapi("RunToolRequest");
  const runToolResponseSchema = z
    .object({})
    .passthrough()
    .openapi("RunToolResponse");
  const suggestToolParamsSchema = z
    .object({})
    .passthrough()
    .openapi("SuggestToolParamsRequest");
  const suggestToolParamsResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SuggestToolParamsResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listTools",
      path: "/v1/tools",
      responses: {
        200: {
          content: { "application/json": { schema: listToolsSchema } },
          description: "Tool list",
        },
      },
      summary: "List all tools",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createTool",
      path: "/v1/tools",
      request: {
        body: {
          content: { "application/json": { schema: createToolSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: createToolResponseSchema } },
          description: "Tool created",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Register a tool",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getToolSource",
      path: "/v1/tools/{toolId}/source",
      request: { params: toolIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: toolSourceSchema } },
          description: "Tool source",
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
      summary: "Get tool source code",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getTool",
      path: "/v1/tools/{toolId}",
      request: { params: toolIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: toolSchema } },
          description: "Tool detail",
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
      summary: "Get a tool",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteTool",
      path: "/v1/tools/{toolId}",
      request: { params: toolIdParam },
      responses: {
        204: { description: "Tool deleted" },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete a registered tool",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "runTool",
      path: "/v1/tools/{toolId}/run",
      request: {
        body: {
          content: { "application/json": { schema: runToolSchema } },
          required: true,
        },
        params: toolIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: runToolResponseSchema } },
          description: "Tool run result",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Run a custom JavaScript or Python tool in the playground",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "suggestToolParams",
      path: "/v1/tools/{toolId}/params/suggest",
      request: {
        body: {
          content: { "application/json": { schema: suggestToolParamsSchema } },
          required: true,
        },
        params: toolIdParam,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: suggestToolParamsResponseSchema },
          },
          description: "Suggested parameters",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Suggest playground parameters for a tool",
      tags: ["Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listProfileTools",
      path: "/v1/profiles/{profileId}/tools",
      request: { params: profileIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: listToolsSchema } },
          description: "Tool list",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List tools assigned to a profile",
      tags: ["Profiles", "Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "assignToolToProfile",
      path: "/v1/profiles/{profileId}/tools",
      request: {
        body: {
          content: { "application/json": { schema: assignToolSchema } },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Tool assigned",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Assign a tool to a profile",
      tags: ["Profiles", "Tools"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "unassignToolFromProfile",
      path: "/v1/profiles/{profileId}/tools/{toolId}",
      request: { params: profileToolParams },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Tool unassigned",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Unassign a tool from a profile",
      tags: ["Profiles", "Tools"],
    })
  );

  app.get("/v1/tools", async () =>
    json<ListToolsResponse>(await agent.listTools())
  );

  app.post("/v1/tools", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateToolRequest>(c.req.raw);
    return json(await agent.createTool(body), 201);
  });

  app.get("/v1/tools/:toolId/source", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    return json<ToolSourceResponse>(
      await agent.getToolSource(decodeURIComponent(c.req.param("toolId")))
    );
  });

  app.get("/v1/tools/:toolId", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    return json<ToolResponse>(
      await agent.getTool(decodeURIComponent(c.req.param("toolId")))
    );
  });

  app.delete("/v1/tools/:toolId", async (c) => {
    requirePlatformAdminFromContext(c);
    await agent.deleteTool(decodeURIComponent(c.req.param("toolId")));
    return new Response(null, { status: 204 });
  });

  app.post("/v1/tools/:toolId/run", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const toolId = decodeURIComponent(c.req.param("toolId"));
    const body = await readJson<RunToolRequest>(c.req.raw);

    try {
      return json<RunToolResponse>(
        await agent.runToolPlayground(toolId, body.parameters ?? {}, {
          orgId,
          userId: auth.user.id,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("not found") ? 404 : 400;
      return json({ error: message }, status);
    }
  });

  app.post("/v1/tools/:toolId/params/suggest", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const toolId = decodeURIComponent(c.req.param("toolId"));
    const body = await readJson<SuggestToolParamsRequest>(c.req.raw);

    try {
      return json<SuggestToolParamsResponse>(
        await agent.suggestToolPlaygroundParams(toolId, body.prompt ?? "")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("not found") ? 404 : 400;
      return json({ error: message }, status);
    }
  });

  app.get("/v1/profiles/:profileId/tools", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<ListToolsResponse>(
      await agent.listProfileTools(
        orgId,
        decodeURIComponent(c.req.param("profileId"))
      )
    );
  });

  app.post("/v1/profiles/:profileId/tools", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<AssignToolRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.assignTool(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        body
      )
    );
  });

  app.delete("/v1/profiles/:profileId/tools/:toolId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<ProfileResponse>(
      await agent.unassignTool(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("toolId"))
      )
    );
  });
}
