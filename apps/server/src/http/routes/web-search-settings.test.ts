import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvValue, setManagedSecretResolver } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { ManagedSecrets } from "../../services/managed-secrets";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

async function createApp() {
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-web-search-route-")
  );

  const databaseAdapter = createInMemoryDatabaseAdapter();

  const secrets = new ManagedSecrets(
    databaseAdapter,
    Buffer.alloc(32, 1).toString("base64")
  );

  setManagedSecretResolver(
    async (scope, name, envNames) =>
      (await secrets.resolve(scope, name, envNames)).value
  );

  return createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter, undefined, secrets),
    databaseAdapter,
  });
}

afterEach(() => {
  setManagedSecretResolver(
    async (_scope, _name, envNames) =>
      envNames.map((name) => readEnvValue(process.env, name)).find(Boolean) ??
      null
  );
});

// The route validates the vendor with its own schema, so a vendor the tool
// supports is still refused until that schema knows it too.
describe("web search settings route", () => {
  test("a platform admin saves Serply and its key", async () => {
    const { app, databaseAdapter } = await createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const saved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/web-search", {
        body: JSON.stringify({ provider: "serply" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );

    expect(saved.status).toBe(200);

    const secret = await app.fetch(
      new Request("http://localhost:4310/v1/settings/web-search/secret", {
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

    expect(secret.status).toBe(200);

    expect(await secret.json()).toMatchObject({
      apiKeyMasked: null,
      configured: true,
      endpoint: "https://api.serply.io/v1/search",
      provider: "serply",
      source: "settings",
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
