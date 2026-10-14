import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type ConfigureProviderRequest,
  type CreateProviderRequest,
  NakamaApiError,
} from "@nakama/core";
import { asTestFetch } from "../../providers/test-helpers";
import { buildProviderInstanceFromCreateRequest } from "../../services/provider-instance-helpers";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

setupTestConfigDir("nakama-unexpected-error-format-test-");

describe("route error formatting", () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  // reportError always writes one "[nakama:<kind>] <source>" line, tracker or not.
  let reported: string[] = [];

  beforeEach(() => {
    reported = [];
    console.error = (first: string) => {
      reported.push(String(first));
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  test("catalog fetch failure does not leak the upstream error's message", async () => {
    globalThis.fetch = asTestFetch(async () => {
      throw new Error(
        "connect ETIMEDOUT 198.51.100.4:443 at TCPConnectWrap.afterConnect"
      );
    });

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
    expect(
      reported.some((line) => line.startsWith("[nakama:http] server"))
    ).toBe(true);
  });

  test("a worker action that fails answers 500 and is reported", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      workerManager: {
        isValidWorker: () => true,
        startWorker: async () => {
          throw new Error("pm2 daemon is not reachable");
        },
      },
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/automation/start", {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).toBe(500);
    expect(
      reported.some((line) => line.startsWith("[nakama:http] server"))
    ).toBe(true);
  });

  test("a 5xx passed through from transcription is reported", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        transcribeAudio: async () => {
          throw new NakamaApiError(
            "Audio transcription returned empty text.",
            502
          );
        },
      },
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/audio/transcribe", {
        body: JSON.stringify({ data: "AAAA", mediaType: "audio/webm" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(502);
    expect(
      reported.some((line) => line.startsWith("[nakama:http] server"))
    ).toBe(true);
  });

  test("send message does not leak an unexpected error's message", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        assertSessionProfileAccess: async () => undefined,
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
    expect(
      reported.some((line) => line.startsWith("[nakama:turn] server"))
    ).toBe(true);
  });

  test("a NakamaApiError is reported only when it is a 5xx", async () => {
    const send = async (error: NakamaApiError) => {
      reported = [];

      const { app, databaseAdapter } = createMinimalHonoApp({
        agent: {
          assertSessionProfileAccess: async () => undefined,
          beginSessionTurn: async () => true,
          resolveSession: async () => {
            throw error;
          },
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

      return { reported: [...reported], status: response.status };
    };

    const refused = await send(new NakamaApiError("Forbidden", 403));
    expect(refused.status).toBe(403);
    expect(refused.reported.some((line) => line.startsWith("[nakama:"))).toBe(
      false
    );

    const broken = await send(
      new NakamaApiError("Database not configured.", 500)
    );

    expect(broken.status).toBe(500);
    expect(
      broken.reported.some((line) => line.startsWith("[nakama:http] server"))
    ).toBe(true);
  });

  test("an unexpected throw that reaches onError is reported", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        assertSessionProfileAccess: async () => undefined,
        beginSessionTurn: async () => true,
        resolveSession: async () => {
          throw new Error("SQLITE_CORRUPT: database disk image is malformed");
        },
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
    expect(
      reported.some((line) => line.startsWith("[nakama:http] server"))
    ).toBe(true);
  });
  test("provider routes reject invalid fields before service calls", async () => {
    const calls: Array<CreateProviderRequest | ConfigureProviderRequest> = [];

    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        createProvider: async (request: CreateProviderRequest) => {
          calls.push(request);

          return { ok: true };
        },
        configureProvider: async (request: ConfigureProviderRequest) => {
          calls.push(request);

          return { ok: true };
        },
      },
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    for (const [path, method, field] of [
      ["/v1/providers", "POST", "type"],
      ["/v1/settings/provider", "PUT", "provider"],
    ] as const) {
      for (const body of [
        {},
        { [field]: "unknown" },
        { [field]: 42 },
        { [field]: "openai", apiKey: 42 },
      ]) {
        const response = await app.fetch(
          new Request("http://localhost:4310" + path, {
            body: JSON.stringify(body),
            headers: session.headers({
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            }),
            method,
          })
        );

        expect(response.status).toBe(400);
      }

      expect(calls).toHaveLength(0);

      const response = await app.fetch(
        new Request("http://localhost:4310" + path, {
          body: JSON.stringify({ [field]: "ollama", model: "local-model" }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

      expect(response.status).toBe(200);
      expect(calls.pop()).toMatchObject({
        [field]: "ollama",
        apiKey: "",
        model: "local-model",
      });
    }
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
