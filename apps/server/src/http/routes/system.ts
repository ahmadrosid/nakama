import { createRoute, z } from "@hono/zod-openapi";
import { isComposioConfiguredAsync, NAKAMA_API_VERSION } from "@nakama/core";
import type { UpdateWebPublicUrlRequest } from "@nakama/core/contract";
import {
  getWebPublicUrlSettings,
  persistWebPublicUrl,
  resolveRequestClientOrigin,
} from "../../services/composio-callback-url";
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

export function registerSystemRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent, databaseAdapter, systemStatus } = options;
  const healthResponseSchema = z
    .object({
      apiVersion: z.number().int(),
      composioAvailable: z.boolean().openapi({
        description:
          "Whether Composio is reachable. Always false on /health (no live probe). Check GET /v1/system/status for the probed value.",
      }),
      composioConfigured: z.boolean().openapi({
        description: "Whether a Composio project API key is saved locally.",
      }),
      ok: z.literal(true),
      providerConfigured: z.boolean(),
      userConfigured: z.boolean(),
    })
    .openapi("HealthResponse");
  const systemStatusSchema = z
    .object({ ok: z.boolean() })
    .passthrough()
    .openapi("SystemStatusResponse");
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");

  const healthRoute = createRoute({
    method: "get",
    operationId: "getHealth",
    path: "/health",
    responses: {
      200: {
        content: { "application/json": { schema: healthResponseSchema } },
        description: "Server is healthy",
      },
    },
    summary: "Health check",
    tags: ["Health"],
  });

  const systemStatusRoute = createRoute({
    method: "get",
    operationId: "getSystemStatus",
    path: "/v1/system/status",
    responses: {
      200: {
        content: { "application/json": { schema: systemStatusSchema } },
        description: "Server and automation worker status",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "System status",
    tags: ["Health"],
  });

  const updateWebPublicUrlRoute = createRoute({
    method: "put",
    operationId: "updateWebPublicUrl",
    path: "/v1/system/web-public-url",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z
              .object({
                webPublicUrl: z.string(),
              })
              .openapi("UpdateWebPublicUrlRequest"),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z
              .object({ webPublicUrl: z.string() })
              .openapi("UpdateWebPublicUrlResponse"),
          },
        },
        description: "Saved web public URL",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Persist the public web app URL for OAuth callbacks",
    tags: ["Health"],
  });

  const getWebPublicUrlRoute = createRoute({
    method: "get",
    operationId: "getWebPublicUrl",
    path: "/v1/system/web-public-url",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z
              .object({
                envOverride: z.string().nullable(),
                webPublicUrl: z.string().nullable(),
              })
              .openapi("WebPublicUrlSettingsResponse"),
          },
        },
        description: "Web public URL settings",
      },
    },
    summary: "Read the saved public web app URL for OAuth callbacks",
    tags: ["Health"],
  });

  app.get(
    "/docs",
    () =>
      new Response(DOCS_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
  );

  app.get(
    "/docs/",
    () =>
      new Response(DOCS_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
  );

  app.openapi(healthRoute, async (c) => {
    // Local checks only — Composio reachability is on GET /v1/system/status.
    const humanUserCount = (await databaseAdapter?.countHumanUsers()) ?? 0;
    const composioConfigured = await isComposioConfiguredAsync();
    return c.json(
      {
        apiVersion: NAKAMA_API_VERSION,
        composioAvailable: false,
        composioConfigured,
        ok: true,
        providerConfigured: agent.providerConfigured,
        userConfigured: humanUserCount > 0,
      },
      200
    );
  });

  app.openapi(systemStatusRoute, async (c) =>
    c.json(await systemStatus.getStatus(), 200)
  );

  app.openapi(getWebPublicUrlRoute, async (c) => {
    requireOrgAdminFromContext(c);
    return c.json(await getWebPublicUrlSettings(), 200);
  });

  app.openAPIRegistry.registerPath(updateWebPublicUrlRoute);

  app.put("/v1/system/web-public-url", async (c) => {
    requireOrgAdminFromContext(c);
    const body = await readJson<UpdateWebPublicUrlRequest>(c.req.raw);
    const webPublicUrl = resolveRequestClientOrigin(
      c.req.raw,
      body.webPublicUrl
    );

    if (!webPublicUrl) {
      return errorResponse("webPublicUrl is required.", 400);
    }

    try {
      return c.json(
        { webPublicUrl: await persistWebPublicUrl(webPublicUrl) },
        200
      );
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : String(error),
        400
      );
    }
  });
}
