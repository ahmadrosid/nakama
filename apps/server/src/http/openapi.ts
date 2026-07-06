import { DEFAULT_SERVER_URL, NAKAMA_API_VERSION } from "@nakama/core";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { HonoApp } from "./types";
import type { ServerOptions } from "./context";
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
  registerTaskRoutes(app, options);
  return app;
}

export function buildHttpOpenApiSpec(app?: HonoApp, serverUrl?: string) {
  const openApiApp = app ?? buildNativeOpenApiApp();
  return openApiApp.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Nakama API",
      version: String(NAKAMA_API_VERSION),
      description: "HTTP API for the Nakama personal AI assistant.",
    },
    servers: [
      {
        url: serverUrl ?? DEFAULT_SERVER_URL,
        description: "Local dev server",
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

export function serializeHttpOpenApiSpec(app?: HonoApp, serverUrl?: string): string {
  return JSON.stringify(buildHttpOpenApiSpec(app, serverUrl), null, 2);
}
