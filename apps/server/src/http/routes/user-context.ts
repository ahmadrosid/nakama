import { createRoute, z } from "@hono/zod-openapi";
import type { InitUserContextResponse, UpdateUserContextRequest, UserContextStatusResponse } from "@tinyclaw/core";
import { json, readJson, getRequestAuth } from "../shared";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";
import { requireActiveOrgIdFromContext } from "../org-guards";

export function registerUserContextRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const userContextStatusSchema = z.object({}).passthrough().openapi("UserContextStatusResponse");
  const updateUserContextSchema = z.object({}).passthrough().openapi("UpdateUserContextRequest");
  const initUserContextSchema = z.object({}).passthrough().openapi("InitUserContextResponse");
  const contentQuerySchema = z.object({
    content: z.enum(["true", "false"]).optional(),
  });

  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/user/context",
    tags: ["User"],
    summary: "Get USER.md status",
    operationId: "getUserContext",
    request: { query: contentQuerySchema },
    responses: {
      200: { description: "User context status", content: { "application/json": { schema: userContextStatusSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/user/context",
    tags: ["User"],
    summary: "Write USER.md",
    operationId: "writeUserContext",
    request: { body: { required: true, content: { "application/json": { schema: updateUserContextSchema } } } },
    responses: {
      204: { description: "User context saved" },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/user/context/init",
    tags: ["User"],
    summary: "Initialize USER.md template",
    operationId: "initUserContext",
    responses: {
      201: { description: "User context initialized", content: { "application/json": { schema: initUserContextSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.get("/v1/user/context", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const includeContent = c.req.query("content") === "true";
    return json<UserContextStatusResponse>(
      await agent.getUserContext(orgId, auth.user.id, includeContent),
    );
  });

  app.put("/v1/user/context", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<UpdateUserContextRequest>(c.req.raw);
    await agent.writeUserContext(orgId, auth.user.id, body);
    return new Response(null, { status: 204 });
  });

  app.post("/v1/user/context/init", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<InitUserContextResponse>(
      await agent.initUserContext(orgId, auth.user.id),
      201,
    );
  });
}
