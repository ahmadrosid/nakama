import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { McpClientManager } from "../../services/mcp-client-manager";
import { McpService } from "../../services/mcp-service";
import { createMinimalHonoApp } from "../test-app-helpers";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  return createMinimalHonoApp({
    databaseAdapter,
    mcpService: new McpService(databaseAdapter, new McpClientManager()),
  });
}

describe("GET /v1/mcp/oauth/callback/:serverId", () => {
  test("answers a page to an unauthenticated browser, not a 401", async () => {
    const { app } = createApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/v1/mcp/oauth/callback/mcp_unknown?code=abc&state=xyz"
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("says the same thing for an unknown server as for a bad state", async () => {
    const { app, databaseAdapter } = createApp();
    const now = new Date().toISOString();
    await databaseAdapter.upsertMcpServer({
      cachedTools: [],
      config: {
        oauth: { callbackBaseUrl: "http://localhost", state: "the-real-state" },
        url: "https://mcp.example.com/mcp",
      },
      createdAt: now,
      enabled: true,
      id: "mcp_known",
      lastError: null,
      name: "known",
      status: "needs_auth",
      transport: "http",
      updatedAt: now,
    });

    const [unknown, wrongState] = await Promise.all(
      ["mcp_unknown", "mcp_known"].map(async (serverId) => {
        const response = await app.fetch(
          new Request(
            `http://localhost/v1/mcp/oauth/callback/${serverId}?code=abc&state=not-the-state`
          )
        );
        return await response.text();
      })
    );

    expect(unknown).toContain("no longer valid");
    expect(wrongState).toBe(unknown as string);
  });

  test("refuses a callback with no code", async () => {
    const { app } = createApp();

    const response = await app.fetch(
      new Request("http://localhost/v1/mcp/oauth/callback/mcp_known?state=xyz")
    );

    expect(response.status).toBe(400);
  });
});
