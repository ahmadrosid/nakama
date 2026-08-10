import { createRoute, z } from "@hono/zod-openapi";
import type {
  InitUserContextResponse,
  UpdateUserContextRequest,
  UserContextStatusResponse,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import { requireActiveOrgIdFromContext } from "../org-guards";
import { getRequestAuth, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerUserContextRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const userContextStatusSchema = z
    .object({})
    .passthrough()
    .openapi("UserContextStatusResponse");
  const updateUserContextSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateUserContextRequest");
  const initUserContextSchema = z
    .object({})
    .passthrough()
    .openapi("InitUserContextResponse");
  const contentQuerySchema = z.object({
    content: z.enum(["true", "false"]).optional(),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getUserContext",
      path: "/v1/user/context",
      request: { query: contentQuerySchema },
      responses: {
        200: {
          content: { "application/json": { schema: userContextStatusSchema } },
          description: "User context status",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get USER.md status",
      tags: ["User"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "writeUserContext",
      path: "/v1/user/context",
      request: {
        body: {
          content: { "application/json": { schema: updateUserContextSchema } },
          required: true,
        },
      },
      responses: {
        204: { description: "User context saved" },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Write USER.md",
      tags: ["User"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "initUserContext",
      path: "/v1/user/context/init",
      responses: {
        201: {
          content: { "application/json": { schema: initUserContextSchema } },
          description: "User context initialized",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Initialize USER.md template",
      tags: ["User"],
    })
  );

  app.get("/v1/user/context", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const includeContent = c.req.query("content") === "true";
    return json<UserContextStatusResponse>(
      await agent.getUserContext(orgId, auth.user.id, includeContent)
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
      201
    );
  });
}
