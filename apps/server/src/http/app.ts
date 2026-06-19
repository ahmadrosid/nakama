import { OpenAPIHono } from "@hono/zod-openapi";
import { createAuthMiddleware } from "./auth-middleware";
import type { ServerOptions } from "./context";
import type { HonoApp } from "./types";
import { TinyClawApiError, formatServerError } from "@tinyclaw/core";
import { errorResponse } from "./shared";
import { registerSystemRoutes } from "./routes/system";
import { registerAuthRoutes } from "./routes/auth";
import { registerWorkerRoutes } from "./routes/workers";
import { registerModelRoutes } from "./routes/models";
import { registerUserContextRoutes } from "./routes/user-context";
import { registerSessionRoutes } from "./routes/sessions";
import { registerProfileRoutes } from "./routes/profiles";
import { registerMcpRoutes } from "./routes/mcp";
import { registerSkillRoutes } from "./routes/skills";
import { registerToolRoutes } from "./routes/tools";
import { registerAutomationRoutes } from "./routes/automations";
import { registerTaskRoutes } from "./routes/tasks";
import { tryServeStaticWeb } from "../static-web";
import { serializeHttpOpenApiSpec } from "./openapi";

export function createHonoApp(options: ServerOptions) {
  const app: HonoApp = new OpenAPIHono();

  app.onError((err) => {
    if (err instanceof TinyClawApiError) {
      return errorResponse(err.message, err.status);
    }

    if (err instanceof SyntaxError) {
      return errorResponse("Invalid JSON in request body.", 400);
    }

    return errorResponse(formatServerError(err), 500);
  });

  app.use("*", async (c, next) => {
    if (options.webDistDir) {
      const staticResponse = tryServeStaticWeb(c.req.raw, options.webDistDir);
      if (staticResponse) {
        return staticResponse;
      }
    }

    await next();
  });

  app.use("*", createAuthMiddleware(options));
  registerSystemRoutes(app, options);
  registerAuthRoutes(app, options);
  registerWorkerRoutes(app, options);
  registerModelRoutes(app, options);
  registerUserContextRoutes(app, options);
  registerSessionRoutes(app, options);
  registerProfileRoutes(app, options);
  registerMcpRoutes(app, options);
  registerSkillRoutes(app, options);
  registerToolRoutes(app, options);
  registerAutomationRoutes(app, options);
  registerTaskRoutes(app, options);

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
