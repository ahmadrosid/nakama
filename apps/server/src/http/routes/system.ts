import { createHash } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import {
  getNakamaVersion,
  isComposioConfiguredAsync,
  NAKAMA_API_VERSION,
  NakamaApiError,
} from "@nakama/core";
import { BUILTIN_TOOL_IDS } from "@nakama/core/tools/protected";
import {
  getWebPublicUrlSettings,
  persistWebPublicUrl,
} from "../../services/composio-callback-url";
import {
  checkNakamaVersion,
  isOnboardingEnabled,
  isUpdateCheckEnabled,
  readUpgradeState,
  requestUpgrade,
} from "../../services/system-status-service";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requirePlatformAdminFromContext,
  requireProfileManageFromContext,
} from "../org-guards";
import { errorResponse, getRequestAuth, readJson } from "../shared";
import type { HonoApp } from "../types";

export const DOCS_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference";

const DOCS_BOOTSTRAP = `
      Scalar.createApiReference("#app", {
        url: "/openapi.json",
        theme: "default",
      });
    `;

export const DOCS_SCRIPT_HASH = `sha256-${createHash("sha256").update(DOCS_BOOTSTRAP).digest("base64")}`;

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nakama API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${DOCS_SCRIPT_URL}"></script>
    <script>${DOCS_BOOTSTRAP}</script>
  </body>
</html>
`;

/**
 * Host page for HTML artifact previews. A `srcdoc` frame inherits the app's
 * strict CSP, so artifact scripts (inline or CDN) never ran. This page carries
 * its own artifact CSP and writes the HTML the parent posts into itself; the
 * web client still loads it sandboxed without `allow-same-origin`.
 */
export const ARTIFACT_FRAME_PATH = "/artifact-frame";

export const ARTIFACT_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' data: https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "sandbox allow-scripts",
  "frame-ancestors 'self'",
].join("; ");

const ARTIFACT_FRAME_HTML = `<!doctype html>
<script>
  addEventListener("message", (event) => {
    if (event.source !== parent || typeof event.data?.nakamaArtifactHtml !== "string") return;
    document.open();
    document.write(event.data.nakamaArtifactHtml);
    document.close();
  });
  parent.postMessage("nakama-artifact-frame-ready", "*");
</script>
`;

const BUILTIN_TOOL_NAMES = Object.keys(BUILTIN_TOOL_IDS);

export function registerSystemRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent, databaseAdapter, systemStatus } = options;

  const healthResponseSchema = z
    .object({
      apiVersion: z.number().int(),
      builtinTools: z.array(z.string()).openapi({
        description:
          "Names of the built-in tools this build registers. The CLI reads it to tell a stale server from a current one before it has credentials.",
      }),
      composioAvailable: z.boolean().openapi({
        description:
          "Whether Composio is reachable. Always false on /health (no live probe). Check GET /v1/system/status for the probed value.",
      }),
      composioConfigured: z.boolean().openapi({
        description: "Whether a Composio project API key is saved locally.",
      }),
      ok: z.literal(true),
      onboardingEnabled: z.boolean().openapi({
        description:
          "Whether NAKAMA_ENABLE_ONBOARDING is on. The web app then asks a new user for a goal.",
      }),
      providerConfigured: z.boolean(),
      updateCheckEnabled: z.boolean().openapi({
        description:
          "False when NAKAMA_DISABLE_UPDATE_CHECK is set. The web app then hides the release check.",
      }),
      userConfigured: z.boolean(),
      version: z.string(),
    })
    .openapi("HealthResponse");

  const systemStatusSchema = z
    .object({
      checkedAt: z.string(),
      server: z.object({ ok: z.boolean() }).passthrough(),
    })
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
    request: { query: z.object({ profileId: z.string().optional() }) },
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
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Platform admin required",
      },
    },
    summary: "Persist the public web app URL for OAuth callbacks",
    tags: ["Health"],
  });

  const versionRoute = createRoute({
    method: "get",
    operationId: "getNakamaVersion",
    path: "/v1/system/version",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z
              .object({
                current: z.string(),
                latest: z.string(),
                releaseUrl: z.string(),
                updateAvailable: z.boolean(),
              })
              .openapi("NakamaVersionResponse"),
          },
        },
        description: "Running version and the newest GitHub release",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Platform admin required",
      },
      404: {
        content: { "application/json": { schema: errorSchema } },
        description: "NAKAMA_DISABLE_UPDATE_CHECK is set",
      },
      502: {
        content: { "application/json": { schema: errorSchema } },
        description: "GitHub releases unreachable",
      },
    },
    summary: "Check for a newer Nakama release",
    tags: ["Health"],
  });

  const upgradeStateSchema = z
    .object({
      available: z.boolean(),
      status: z
        .object({
          at: z.string(),
          message: z.string(),
          state: z.enum(["running", "done", "failed", "rolled_back"]),
          version: z.string(),
        })
        .nullable(),
    })
    .openapi("NakamaUpgradeResponse");

  const upgradeStateRoute = createRoute({
    method: "get",
    operationId: "getNakamaUpgrade",
    path: "/v1/system/upgrade",
    responses: {
      200: {
        content: { "application/json": { schema: upgradeStateSchema } },
        description: "Whether the updater runs, and the last upgrade",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Platform admin required",
      },
    },
    summary: "Read the upgrade status",
    tags: ["Health"],
  });

  const startUpgradeRoute = createRoute({
    method: "post",
    operationId: "startNakamaUpgrade",
    path: "/v1/system/upgrade",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z
              .object({ version: z.string() })
              .openapi("StartNakamaUpgradeRequest"),
          },
        },
        required: true,
      },
    },
    responses: {
      202: {
        content: { "application/json": { schema: upgradeStateSchema } },
        description: "Upgrade handed to the updater",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Not a newer release",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Platform admin required",
      },
      409: {
        content: { "application/json": { schema: errorSchema } },
        description: "No updater, or an upgrade is running",
      },
    },
    summary: "Upgrade this install to a newer release",
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
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Platform admin required",
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

  app.get(
    ARTIFACT_FRAME_PATH,
    () =>
      new Response(ARTIFACT_FRAME_HTML, {
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
        builtinTools: BUILTIN_TOOL_NAMES,
        composioAvailable: false,
        composioConfigured,
        ok: true,
        onboardingEnabled: isOnboardingEnabled(),
        providerConfigured: agent.providerConfigured,
        updateCheckEnabled: isUpdateCheckEnabled(),
        userConfigured: humanUserCount > 0,
        version: getNakamaVersion(),
      },
      200
    );
  });

  app.openapi(systemStatusRoute, async (c) => {
    const profileId = c.req.query("profileId")?.trim();
    const auth = getRequestAuth(c);
    const orgId = auth.activeOrgId ?? null;

    if (profileId) {
      await requireProfileManageFromContext(c, agent, {
        allowOrgAdmin: true,
        profileId,
      });
      await agent.getProfile(requireActiveOrgIdFromContext(c), profileId);
    }

    return c.json(
      await systemStatus.getStatus(
        profileId && orgId ? { orgId, profileId } : orgId,
        {
          includeUsageByActor: auth.orgRole === "admin" || auth.isPlatformAdmin,
          viewer: {
            isPlatformAdmin: auth.isPlatformAdmin,
            userId: auth.user.id,
          },
        }
      ),
      200
    );
  });

  app.openapi(versionRoute, async (c) => {
    requirePlatformAdminFromContext(c);

    if (!isUpdateCheckEnabled()) {
      throw new NakamaApiError("Update check is disabled.", 404);
    }

    return c.json(await checkNakamaVersion(getNakamaVersion()), 200);
  });

  app.openapi(upgradeStateRoute, async (c) => {
    requirePlatformAdminFromContext(c);

    return c.json(await readUpgradeState(), 200);
  });

  app.openAPIRegistry.registerPath(startUpgradeRoute);

  app.post("/v1/system/upgrade", async (c) => {
    requirePlatformAdminFromContext(c);

    const body = await readJson(
      c.req.raw,
      z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict()
    );

    return c.json(await requestUpgrade(body.version, getNakamaVersion()), 202);
  });

  app.openapi(getWebPublicUrlRoute, async (c) => {
    requirePlatformAdminFromContext(c);

    return c.json(await getWebPublicUrlSettings(), 200);
  });

  app.openAPIRegistry.registerPath(updateWebPublicUrlRoute);

  app.put("/v1/system/web-public-url", async (c) => {
    // Install-wide config, not an organization setting: this base is where
    // OAuth state and share links are delivered, so an org admin must not be
    // able to point it at a host they control.
    requirePlatformAdminFromContext(c);

    const body = await readJson(
      c.req.raw,
      z.object({ webPublicUrl: z.string() }).strict()
    );

    // Only the body sets this. Falling back to Origin/Referer would let a header
    // pin the base an OAuth code is delivered to, which is what #712 took away
    // from the read path.
    const webPublicUrl = body.webPublicUrl?.trim();

    if (!webPublicUrl) {
      return errorResponse("webPublicUrl is required.", 400);
    }

    try {
      return c.json(
        {
          webPublicUrl: await persistWebPublicUrl(webPublicUrl, c.req.raw),
        },
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
