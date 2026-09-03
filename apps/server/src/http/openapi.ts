import { OpenAPIHono } from "@hono/zod-openapi";
import { DEFAULT_SERVER_URL, NAKAMA_API_VERSION } from "@nakama/core";
import type { ServerOptions } from "./context";
import { registerAuthRoutes } from "./routes/auth";
import { registerAutomationRoutes } from "./routes/automations";
import { registerMcpRoutes } from "./routes/mcp";
import { registerModelRoutes } from "./routes/models";
import { registerOrgCuratorRoutes } from "./routes/org-curator";
import { registerProfileRoutes } from "./routes/profiles";
import { registerSessionRoutes } from "./routes/sessions";
import { registerSkillRoutes } from "./routes/skills";
import { registerSystemRoutes } from "./routes/system";
import { registerTaskRoutes } from "./routes/tasks";
import { registerToolRoutes } from "./routes/tools";
import { registerUserContextRoutes } from "./routes/user-context";
import { registerWorkerRoutes } from "./routes/workers";
import { registerWorkflowRoutes } from "./routes/workflows";
import type { HonoApp } from "./types";

function buildNativeOpenApiApp(): HonoApp {
  const app = new OpenAPIHono() as HonoApp;
  const options = {} as ServerOptions;
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
  registerWorkflowRoutes(app, options);
  registerTaskRoutes(app, options);
  registerOrgCuratorRoutes(app, options);
  return app;
}

export function buildHttpOpenApiSpec(app?: HonoApp, serverUrl?: string) {
  const openApiApp = app ?? buildNativeOpenApiApp();
  return openApiApp.getOpenAPI31Document({
    info: {
      description: "HTTP API for the Nakama personal AI assistant.",
      title: "Nakama API",
      version: String(NAKAMA_API_VERSION),
    },
    openapi: "3.1.0",
    servers: [
      {
        description: "Local dev server",
        url: serverUrl ?? DEFAULT_SERVER_URL,
      },
    ],
    tags: [
      { name: "Health" },
      { name: "Auth" },
      { name: "Workers" },
      { name: "Chat" },
      { name: "Models" },
      { name: "User" },
      { name: "Profiles" },
      { name: "Soul" },
      { name: "Skills" },
      { name: "MCP" },
      { name: "Tools" },
      { name: "Automations" },
      { name: "Tasks" },
    ],
  });
}

export function serializeHttpOpenApiSpec(
  app?: HonoApp,
  serverUrl?: string
): string {
  return JSON.stringify(buildHttpOpenApiSpec(app, serverUrl), null, 2);
}
