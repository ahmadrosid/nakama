import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

setupTestConfigDir("nakama-tools-catalog-auth-test-");

// packages/core/src/ensure-server.ts reads these off /health before the CLI has
// credentials. If any of them stops being served there, the CLI decides the
// running server is stale and spawns a second one.
const REQUIRED_BUILTIN_TOOLS = [
  "write_file",
  "delete_file",
  "edit_file",
  "read_file",
  "search_files",
  "web_search",
];

function createApp() {
  const agent = {
    listProfiles: async () => ({ profiles: [{ id: "default" }] }),
    listTools: async () => ({
      tools: [{ id: "tool_custom_scraper", name: "custom_scraper" }],
    }),
    providerConfigured: true,
  };

  return createMinimalHonoApp({ agent });
}

describe("GET /v1/tools", () => {
  test("rejects anonymous callers", async () => {
    const { app } = createApp();

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools")
    );

    expect(response.status).toBe(401);
  });

  test("serves the catalog to an authenticated caller", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tools: [{ id: "tool_custom_scraper", name: "custom_scraper" }],
    });
  });
});

describe("GET /health", () => {
  test("carries the built-in tool names the CLI probe needs", async () => {
    const { app } = createApp();

    const response = await app.fetch(
      new Request("http://localhost:4310/health")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { builtinTools: string[] };
    for (const name of REQUIRED_BUILTIN_TOOLS) {
      expect(payload.builtinTools).toContain(name);
    }
  });

  test("exposes the installed Nakama application version", async () => {
    const previous = process.env.NAKAMA_VERSION;
    process.env.NAKAMA_VERSION = "v1.2.3";
    try {
      const { app } = createApp();
      const response = await app.fetch(
        new Request("http://localhost:4310/health")
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        version: "1.2.3",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_VERSION;
      } else {
        process.env.NAKAMA_VERSION = previous;
      }
    }
  });
});
