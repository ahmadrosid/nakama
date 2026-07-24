import { OpenAPIHono } from "@hono/zod-openapi";
import { createAuthMiddleware } from "./auth-middleware";
import { createOrgContextMiddleware } from "./org-middleware";
import type { ServerOptions } from "./context";
import type { HonoApp } from "./types";
import { NakamaApiError, formatServerError } from "@nakama/core";
import { errorResponse } from "./shared";
import { registerSystemRoutes } from "./routes/system";
import { registerAuthRoutes } from "./routes/auth";
import { registerWorkerRoutes } from "./routes/workers";
import { registerModelRoutes } from "./routes/models";
import { registerUserContextRoutes } from "./routes/user-context";
import { registerSessionRoutes } from "./routes/sessions";
import { registerProfileRoutes } from "./routes/profiles";
import { registerArtifactShareRoutes } from "./routes/artifact-shares";
import { registerMcpRoutes } from "./routes/mcp";
import { registerSkillRoutes } from "./routes/skills";
import { registerToolRoutes } from "./routes/tools";
import { registerAutomationRoutes } from "./routes/automations";
import { registerTaskRoutes } from "./routes/tasks";
import { registerPlatformOrgRoutes } from "./routes/platform-orgs";
import { registerOrgMemberRoutes } from "./routes/org-members";
import { registerInferenceGatewayRoutes } from "./routes/inference-gateway";
import { registerCodingAgentRoutes } from "./routes/coding-agents";
import { registerInternalAutomationRoutes } from "./routes/internal-automations";
import { registerNotificationDestinationRoutes } from "./routes/notification-destinations";
import { registerNotificationWebhookRoutes } from "./routes/notification-webhooks";
import { registerComposioOAuthRoutes, registerComposioRoutes } from "./routes/composio";
import { registerDataPortabilityRoutes } from "./routes/data-portability";
import { tryServeStaticWeb } from "../static-web";
import { serializeHttpOpenApiSpec } from "./openapi";

export function createHonoApp(options: ServerOptions) {
  const app: HonoApp = new OpenAPIHono();

  app.onError((err) => {
    if (err instanceof NakamaApiError) {
      return errorResponse(
        err.message,
        err.status,
        err.profiles ? { profiles: err.profiles } : undefined,
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
      headers.set("X-Frame-Options", "DENY");
      headers.set("X-XSS-Protection", "1; mode=block");
      // Only set Referrer-Policy if it's not already set
      if (!headers.has("Referrer-Policy")) {
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      }
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';");
      // Only enable HSTS if the request is secure (HTTPS)
      if (new URL(c.req.url).protocol === "https:") {
        headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
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

  app.use("*", createAuthMiddleware(options));
  registerInternalAutomationRoutes(app, options);
  registerNotificationWebhookRoutes(app, options);
  registerComposioOAuthRoutes(app, options);
  app.use("*", createOrgContextMiddleware(options));
  registerSystemRoutes(app, options);
  registerAuthRoutes(app, options);
  registerWorkerRoutes(app, options);
  registerModelRoutes(app, options);
  registerUserContextRoutes(app, options);
  registerSessionRoutes(app, options);
  registerProfileRoutes(app, options);
  registerArtifactShareRoutes(app, options);
  registerMcpRoutes(app, options);
  registerSkillRoutes(app, options);
  registerToolRoutes(app, options);
  registerAutomationRoutes(app, options);
  registerNotificationDestinationRoutes(app, options);
  registerComposioRoutes(app, options);
  registerTaskRoutes(app, options);
  registerPlatformOrgRoutes(app, options);
  registerDataPortabilityRoutes(app, options);
  registerOrgMemberRoutes(app, options);
  registerInferenceGatewayRoutes(app, options);
  registerCodingAgentRoutes(app, options);

  app.get("/openapi.json", (c) => {
    const serverUrl = new URL(c.req.url).origin;
    return new Response(serializeHttpOpenApiSpec(app, serverUrl), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  });

  app.all("*", (c) => {
    return errorResponse("Not found", 404);
  });

  return app;
}
