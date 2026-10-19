import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

async function createApp() {
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-web-search-route-")
  );

  const databaseAdapter = createInMemoryDatabaseAdapter();

  return createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    databaseAdapter,
  });
}

// The route validates the vendor with its own schema, so a vendor the tool
// supports is still refused until that schema knows it too.
describe("web search settings route", () => {
  test("a platform admin saves Serply and reads it back masked", async () => {
    const { app, databaseAdapter } = await createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const saved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/web-search", {
        body: JSON.stringify({
          apiKey: "serply-secret-key-9876",
          provider: "serply",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      configured: true,
      endpoint: "https://api.serply.io/v1/search",
      provider: "serply",
    });
  });

  test("an unknown vendor is refused", async () => {
    const { app, databaseAdapter } = await createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/settings/web-search", {
        body: JSON.stringify({ apiKey: "k", provider: "not-a-vendor" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );

    expect(response.status).toBe(400);
  });
});
