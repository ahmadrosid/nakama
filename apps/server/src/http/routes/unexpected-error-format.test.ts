import { afterEach, describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

setupTestConfigDir("nakama-unexpected-error-format-test-");

describe("route error formatting", () => {
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

  test("send message does not leak an unexpected error's message", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        beginSessionTurn: async () => true,
        resolveSession: async () => ({
          send: async () => {
            throw new Error(
              "ENOSPC: no space left on device, write /home/nakama/.config/nakama/nakama.db"
            );
          },
        }),
      },
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/sessions/session_1/messages", {
        body: JSON.stringify({ message: "hi" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "An unexpected server error occurred.",
    });
  });
});
