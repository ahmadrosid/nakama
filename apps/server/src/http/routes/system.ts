import { createRoute, z } from "@hono/zod-openapi";
import { isComposioConfiguredAsync, NAKAMA_API_VERSION } from "@nakama/core";
import type { UpdateWebPublicUrlRequest } from "@nakama/core/contract";
import { persistWebPublicUrl, getWebPublicUrlSettings, resolveRequestClientOrigin } from "../../services/composio-callback-url";
import type { ServerOptions } from "../context";
import { requireOrgAdminFromContext } from "../org-guards";
import { errorResponse, readJson } from "../shared";
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
    composioConfigured: z.boolean().openapi({
      description: "Whether a Composio project API key is saved locally.",
    }),
    composioAvailable: z.boolean().openapi({
      description:
        "Whether Composio is reachable. Always false on /health (no live probe). Check GET /v1/system/status for the probed value.",
    }),
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

  const updateWebPublicUrlRoute = createRoute({
    method: "put",
    path: "/v1/system/web-public-url",
    tags: ["Health"],
    summary: "Persist the public web app URL for OAuth callbacks",
    operationId: "updateWebPublicUrl",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                webPublicUrl: z.string(),
              })
              .openapi("UpdateWebPublicUrlRequest"),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Saved web public URL",
        content: {
          "application/json": {
            schema: z.object({ webPublicUrl: z.string() }).openapi("UpdateWebPublicUrlResponse"),
          },
        },
      },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const getWebPublicUrlRoute = createRoute({
    method: "get",
    path: "/v1/system/web-public-url",
    tags: ["Health"],
    summary: "Read the saved public web app URL for OAuth callbacks",
    operationId: "getWebPublicUrl",
    responses: {
      200: {
        description: "Web public URL settings",
        content: {
          "application/json": {
            schema: z
              .object({
                webPublicUrl: z.string().nullable(),
                envOverride: z.string().nullable(),
              })
              .openapi("WebPublicUrlSettingsResponse"),
          },
        },
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
    // Local checks only — Composio reachability is on GET /v1/system/status.
    const humanUserCount = (await databaseAdapter?.countHumanUsers()) ?? 0;
    const composioConfigured = await isComposioConfiguredAsync();
    return c.json({
      ok: true,
      apiVersion: NAKAMA_API_VERSION,
      providerConfigured: agent.providerConfigured,
      userConfigured: humanUserCount > 0,
      composioConfigured,
      composioAvailable: false,
    }, 200);
  });

  app.openapi(systemStatusRoute, async (c) => {
    return c.json(await systemStatus.getStatus(), 200);
  });

  app.openapi(getWebPublicUrlRoute, async (c) => {
    requireOrgAdminFromContext(c);
    return c.json(await getWebPublicUrlSettings(), 200);
  });

  app.openAPIRegistry.registerPath(updateWebPublicUrlRoute);

  app.put("/v1/system/web-public-url", async (c) => {
    requireOrgAdminFromContext(c);
    const body = await readJson<UpdateWebPublicUrlRequest>(c.req.raw);
    const webPublicUrl = resolveRequestClientOrigin(c.req.raw, body.webPublicUrl);

    if (!webPublicUrl) {
      return errorResponse("webPublicUrl is required.", 400);
    }

    try {
      return c.json({ webPublicUrl: await persistWebPublicUrl(webPublicUrl) }, 200);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });
}
