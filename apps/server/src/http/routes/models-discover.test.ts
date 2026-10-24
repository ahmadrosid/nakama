import { expect, test } from "bun:test";
import type { DiscoverModelsRequest } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-models-discover-test-");

test("discover hands provider and hostMode to the service", async () => {
  const received: DiscoverModelsRequest[] = [];
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const { app, authService } = createMinimalHonoApp({
    agent: {
      discoverModels: async (request: DiscoverModelsRequest) => {
        received.push(request);

        // SAFETY: The route only serializes what the service returns.
        return {} as never;
      },
    },
    databaseAdapter,
  });

  await seedOrgAdmin(databaseAdapter, { authService });

  const session = await loginUserSession(
    app,
    "admin@example.com",
    "password123",
    "org_test"
  );

  const response = await app.fetch(
    new Request("http://localhost:4310/v1/models/discover", {
      body: JSON.stringify({
        apiKey: "key",
        baseUrl: "https://ollama.com",
        hostMode: "cloud",
        provider: "ollama",
      }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  // Both keys are what pick the provider-specific fetch path.
  expect(received).toEqual([
    {
      apiKey: "key",
      baseUrl: "https://ollama.com",
      hostMode: "cloud",
      provider: "ollama",
    },
  ]);
});
