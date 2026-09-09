import { OpenAPIHono } from "@hono/zod-openapi";
import { formatServerError, log, NakamaApiError } from "@nakama/core";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { tryServeStaticWeb } from "../static-web";
import { createAuthMiddleware } from "./auth-middleware";
import type { ServerOptions } from "./context";
import { serializeHttpOpenApiSpec } from "./openapi";
import { createOrgContextMiddleware } from "./org-middleware";
import { createRateLimitMiddleware } from "./rate-limit-middleware";
import { registerArtifactShareRoutes } from "./routes/artifact-shares";
import { registerAuthRoutes } from "./routes/auth";
import { registerAutomationWorkerSettingsRoutes } from "./routes/automation-worker-settings";
import { registerAutomationRoutes } from "./routes/automations";
import { registerCodingHarnessSettingsRoutes } from "./routes/coding-harnesses";
import {
  registerComposioOAuthRoutes,
  registerComposioRoutes,
} from "./routes/composio";
import { registerDataPortabilityRoutes } from "./routes/data-portability";
import { registerInternalAutomationRoutes } from "./routes/internal-automations";
import { registerInternalCuratorRoutes } from "./routes/internal-curator";
import { registerMcpRoutes } from "./routes/mcp";
import { registerModelRoutes } from "./routes/models";
import { registerNotificationDestinationRoutes } from "./routes/notification-destinations";
import { registerNotificationWebhookRoutes } from "./routes/notification-webhooks";
import { registerOrgCuratorRoutes } from "./routes/org-curator";
import { registerOrgMemberRoutes } from "./routes/org-members";
import { registerOrgMemoryRoutes } from "./routes/org-memory";
import { registerPlatformOrgRoutes } from "./routes/platform-orgs";
import { registerPluginRoutes } from "./routes/plugins";
import { registerProfilePortabilityRoutes } from "./routes/profile-portability";
import { registerProfileRoutes } from "./routes/profiles";
import { registerSessionRoutes } from "./routes/sessions";
import { registerSetupImportRoutes } from "./routes/setup-import";
import { registerSkillProposalRoutes } from "./routes/skill-proposals";
import { registerSkillSuggestionRoutes } from "./routes/skill-suggestions";
import { registerSkillRoutes } from "./routes/skills";
import { registerSystemRoutes } from "./routes/system";
import { registerTokenOptimizationRoutes } from "./routes/token-optimization";
import { registerToolRoutes } from "./routes/tools";
import { registerUserContextRoutes } from "./routes/user-context";
import { registerWorkerRoutes } from "./routes/workers";
import { errorResponse, isSecureRequest } from "./shared";
import type { HonoApp } from "./types";

/**
 * Hash of the theme bootstrap inlined in `apps/web/index.html`, which has to run
 * before first paint and so cannot be an external file. Editing that script
 * changes this value; `app.test.ts` recomputes it from the file and fails when
 * the two drift, which is the only thing keeping this constant honest.
 */
const THEME_BOOTSTRAP_SCRIPT_HASH =
  "sha256-rQ5OTxagyMHDDSQ6k5wlUK8gtuYxXBrpQGqjAcYBz2w=";
// Regular JSON can carry a 5 MiB attachment after base64 expansion. Full-data
// imports accept a 100 MiB archive, which expands to roughly 134 MiB as base64.
export const DEFAULT_HTTP_REQUEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const MAX_HTTP_REQUEST_BODY_LIMIT_BYTES = 140 * 1024 * 1024;
const LARGE_BODY_ROUTES = new Set([
  "/v1/auth/setup/import/preview",
  "/v1/auth/setup/import/restore",
  "/v1/platform/data/import/preview",
  "/v1/platform/data/import/restore",
  "/v1/profiles/pack/import",
  "/v1/profiles/pack/import/preview",
]);

function readPositiveEnv(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function createHonoApp(options: ServerOptions) {
  const app: HonoApp = new OpenAPIHono();
  const metricsEnabled = process.env.NAKAMA_METRICS === "true";
  let requests = 0;
  let serverErrors = 0;

  app.use("*", requestId());
  app.use("*", async (c, next) => {
    const fields = { method: c.req.method, requestId: c.get("requestId") };
    const start = performance.now();
    log("debug", "http.request", fields);
    await next();
    c.header("X-Request-Id", fields.requestId);
    const status = c.res.status;
    if (metricsEnabled) {
      requests += 1;
      if (status >= 500) {
        serverErrors += 1;
      }
    }
    if (status >= 500) {
      // Never log raw URLs: paths and queries can contain share/OAuth tokens.
      log("error", "http.response", {
        ...fields,
        durationMs: Math.round(performance.now() - start),
        status,
      });
    }
  });

  app.onError((err) => {
    if (err instanceof NakamaApiError) {
      return errorResponse(
        err.message,
        err.status,
        err.profiles ? { profiles: err.profiles } : undefined
      );
    }

    if (err instanceof SyntaxError) {
      return errorResponse("Invalid JSON in request body.", 400);
    }

    return errorResponse(formatServerError(err), 500);
  });

  app.use("*", async (c, next) => {
    const applySecurityHeaders = (response: Response) => {
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      const contentType = headers.get("Content-Type") ?? "";
      const pluginDocument =
        new URL(c.req.url).pathname.startsWith("/v1/plugins/ui/") &&
        contentType.includes("text/html");
      if (pluginDocument) {
        headers.set("X-Frame-Options", "SAMEORIGIN");
      } else {
        headers.set("X-Frame-Options", "DENY");
      }
      // Only set Referrer-Policy if it's not already set
      if (!headers.has("Referrer-Policy")) {
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      }
      headers.set(
        "Content-Security-Policy",
        pluginDocument
          ? `default-src 'self'; script-src 'self' '${THEME_BOOTSTRAP_SCRIPT_HASH}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self';`
          : `default-src 'self'; script-src 'self' '${THEME_BOOTSTRAP_SCRIPT_HASH}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self';`
      );
      // Also true behind a TLS terminator, which is where HSTS matters most.
      if (isSecureRequest(c.req.raw)) {
        headers.set(
          "Strict-Transport-Security",
          "max-age=31536000; includeSubDomains"
        );
      }
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    };

    if (options.webDistDir) {
      const staticResponse = tryServeStaticWeb(c.req.raw, options.webDistDir);
      if (staticResponse) {
        return applySecurityHeaders(staticResponse);
      }
    }

    await next();

    // Apply security headers to the final response
    const finalResponse = c.res;
    c.res = applySecurityHeaders(finalResponse);
  });

  const rejectOversizedBody = () =>
    errorResponse("Request body is too large.", 413);
  const defaultBodyLimit = bodyLimit({
    maxSize: DEFAULT_HTTP_REQUEST_BODY_LIMIT_BYTES,
    onError: rejectOversizedBody,
  });
  const importBodyLimit = bodyLimit({
    maxSize: MAX_HTTP_REQUEST_BODY_LIMIT_BYTES,
    onError: rejectOversizedBody,
  });
  app.use("*", (c, next) => {
    const limit = LARGE_BODY_ROUTES.has(c.req.path)
      ? importBodyLimit
      : defaultBodyLimit;
    return limit(c, next);
  });

  // Probes must work before setup/login; they reveal no tenant or config data.
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      if (!options.databaseAdapter) {
        return c.json({ ok: false }, 503);
      }
      // Startup/reopen run migrations before exposing the adapter.
      await options.databaseAdapter.checkHealth();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  app.get("/metrics", (c) => {
    if (!metricsEnabled) {
      return c.notFound();
    }
    c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    c.header("Cache-Control", "no-store");
    return c.body(
      [
        "# HELP nakama_http_requests_total HTTP responses served by this process.",
        "# TYPE nakama_http_requests_total counter",
        `nakama_http_requests_total ${requests}`,
        "# HELP nakama_http_server_errors_total HTTP responses with a 5xx status.",
        "# TYPE nakama_http_server_errors_total counter",
        `nakama_http_server_errors_total ${serverErrors}`,
        "",
      ].join("\n")
    );
  });

  // Ahead of auth so an unauthenticated flood is refused before it reaches
  // bcrypt or the database.
  app.use(
    "*",
    createRateLimitMiddleware({
      authMax: readPositiveEnv("NAKAMA_RATE_LIMIT_AUTH_MAX"),
      max: readPositiveEnv("NAKAMA_RATE_LIMIT_MAX"),
      trustProxy: process.env.NAKAMA_TRUST_PROXY === "true",
    })
  );

  app.use("*", createAuthMiddleware(options));
  registerInternalAutomationRoutes(app, options);
  registerInternalCuratorRoutes(app, options);
  registerNotificationWebhookRoutes(app, options);
  registerComposioOAuthRoutes(app, options);
  app.use("*", createOrgContextMiddleware(options));
  registerSystemRoutes(app, options);
  registerAuthRoutes(app, options);
  registerSetupImportRoutes(app, options);
  registerWorkerRoutes(app, options);
  registerModelRoutes(app, options);
  registerUserContextRoutes(app, options);
  registerSessionRoutes(app, options);
  registerProfileRoutes(app, options);
  registerProfilePortabilityRoutes(app, options);
  registerArtifactShareRoutes(app, options);
  registerMcpRoutes(app, options);
  registerSkillRoutes(app, options);
  registerToolRoutes(app, options);
  registerPluginRoutes(app, options);
  registerAutomationRoutes(app, options);
  registerNotificationDestinationRoutes(app, options);
  registerTokenOptimizationRoutes(app, options);
  registerAutomationWorkerSettingsRoutes(app, options);
  registerCodingHarnessSettingsRoutes(app, options);
  registerComposioRoutes(app, options);
  registerPlatformOrgRoutes(app, options);
  registerDataPortabilityRoutes(app, options);
  registerOrgMemberRoutes(app, options);
  registerOrgMemoryRoutes(app, options);
  registerOrgCuratorRoutes(app, options);
  registerSkillProposalRoutes(app, options);
  registerSkillSuggestionRoutes(app, options);

  app.get("/openapi.json", (c) => {
    const serverUrl = new URL(c.req.url).origin;
    return new Response(serializeHttpOpenApiSpec(app, serverUrl), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  });

  app.all("*", (c) => errorResponse("Not found", 404));

  return app;
}
