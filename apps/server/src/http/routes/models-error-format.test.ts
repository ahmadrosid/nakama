import { afterEach, describe, expect, test } from "bun:test";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

describe("model routes error formatting", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("catalog fetch failure does not leak the upstream error's message", async () => {
    globalThis.fetch = async () => {
      throw new Error(
        "connect ETIMEDOUT 198.51.100.4:443 at TCPConnectWrap.afterConnect"
      );
    };

    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/model-catalogs/openrouter", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "An unexpected server error occurred.",
    });
  });

  test("discover models does not leak an unexpected error's message", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        discoverModels: async () => {
          throw new Error(
            "getaddrinfo ENOTFOUND internal-provider.nakama.local"
          );
        },
      },
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/models/discover", {
        body: JSON.stringify({ baseUrl: "https://example.com" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "An unexpected server error occurred.",
    });
  });
});
