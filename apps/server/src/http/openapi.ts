import { DEFAULT_SERVER_URL, NAKAMA_API_VERSION } from "@nakama/core";
import type { HonoApp } from "./types";

export function buildHttpOpenApiSpec(app: HonoApp, serverUrl?: string) {
  return app.getOpenAPI31Document({
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
  app: HonoApp,
  serverUrl?: string
): string {
  return JSON.stringify(buildHttpOpenApiSpec(app, serverUrl), null, 2);
}
