import { afterEach, describe, expect, test } from "bun:test";
import type { ConfigureProviderRequest } from "@nakama/core";
import { buildProviderInstanceFromCreateRequest } from "../../services/provider-instance-helpers";
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
  test("invalid provider settings answer 400 with the validation message", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        // The real builder, mapped the way AgentService.configureProvider maps it,
        // so the throw is the validation this route has to answer.
        configureProvider: async (request: ConfigureProviderRequest) =>
          buildProviderInstanceFromCreateRequest(
            {
              apiKey: request.apiKey,
              baseUrl: request.baseUrl,
              label: request.displayName,
              model: request.model,
              type: request.provider,
            },
            []
          ),
      },
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/settings/provider", {
        body: JSON.stringify({
          apiKey: "sk-test",
          baseUrl: "http://127.0.0.1:9/v1",
          model: "test-model",
          provider: "openai_compatible",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Provider name is required.",
    });
  });
});
