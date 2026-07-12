import { createRoute, z } from "@hono/zod-openapi";
import { isComposioConfiguredAsync, NAKAMA_API_VERSION } from "@nakama/core";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nakama API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "/openapi.json",
        theme: "default",
      });
    </script>
  </body>
</html>
`;

export function registerSystemRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, databaseAdapter, systemStatus } = options;
  const healthResponseSchema = z.object({
    ok: z.literal(true),
    apiVersion: z.number().int(),
    providerConfigured: z.boolean(),
    userConfigured: z.boolean(),
    composioAvailable: z.boolean(),
  }).openapi("HealthResponse");
  const systemStatusSchema = z.object({ ok: z.boolean() }).passthrough().openapi("SystemStatusResponse");
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");

  const healthRoute = createRoute({
    method: "get",
    path: "/health",
    tags: ["Health"],
    summary: "Health check",
    operationId: "getHealth",
    responses: {
      200: {
        description: "Server is healthy",
        content: { "application/json": { schema: healthResponseSchema } },
      },
    },
  });

  const systemStatusRoute = createRoute({
    method: "get",
    path: "/v1/system/status",
    tags: ["Health"],
    summary: "System status",
    operationId: "getSystemStatus",
    responses: {
      200: {
        description: "Server and automation worker status",
        content: { "application/json": { schema: systemStatusSchema } },
      },
      500: {
        description: "Error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  });

  app.get("/docs", () => {
    return new Response(DOCS_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });

  app.get("/docs/", () => {
    return new Response(DOCS_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });

  app.openapi(healthRoute, async (c) => {
    const humanUserCount = (await databaseAdapter?.countHumanUsers()) ?? 0;
    return c.json({
      ok: true,
      apiVersion: NAKAMA_API_VERSION,
      providerConfigured: agent.providerConfigured,
      userConfigured: humanUserCount > 0,
      composioAvailable: await isComposioConfiguredAsync(),
    }, 200);
  });

  app.openapi(systemStatusRoute, async (c) => {
    return c.json(await systemStatus.getStatus(), 200);
  });
}
