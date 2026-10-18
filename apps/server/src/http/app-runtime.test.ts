import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadLocalAuthToken, verifyLocalAuthToken } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
} from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { GoogleMeetService } from "../services/google-meet/service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import {
  createHonoApp,
  DEFAULT_HTTP_REQUEST_BODY_LIMIT_BYTES,
  MAX_HTTP_REQUEST_BODY_LIMIT_BYTES,
} from "./app";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  LOCAL_CLIENT_EMAIL,
  seedLocalClientUser,
  seedOrgForUser,
  TEST_ORG_ID,
} from "./test-org-helpers";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-http-app-test-");

function createServerOptions() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  // SAFETY: The test checks this response against the endpoint contract asserted below.
  return {
    agent: {
      assertSessionProfileAccess: async () => {},
      beginSessionTurn: async () => true,
      createSession: async () => "session_1",
      getProfile: async () => ({ profile: { id: "default" } }),
      getSessionMessages: async () => ({
        channel: "web",
        contextUsage: null,
        messageMeta: [],
        messages: [],
        model: null,
        questionnaire: null,
        todos: [],
      }),
      getSessionQuestionnaire: async () => null,
      getSessionTodos: async () => [],
      getWhatsAppSettings: async () => ({ enabled: false }),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      listSessions: async (
        _orgId: string,
        profileId: string,
        channel: string
      ) => ({
        sessions: [{ id: `${profileId}-${channel}` }],
      }),
      listSkills: async () => ({ skills: [] }),
      providerConfigured: true,
      resolveSession: async () => ({
        send: async (input: { message: string }) => `reply:${input.message}`,
      }),
    } as any,
    authService,
    automationService: {} as any,
    databaseAdapter,
    mcpService: {} as any,
    orgService: new OrgService(databaseAdapter, authService),
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    webDistDir: null,
    workerManager: {
      isValidWorker: () => true,
      startWorker: async () => {},
      stopWorker: async () => {},
    } as any,
  };
}

describe("createHonoApp", () => {
  test("built-in Meet routes use current org roles and reject spoofed actor fields", async () => {
    const options = createServerOptions();
    const root = await mkdtemp(join(tmpdir(), "meet-http-"));

    const googleMeetService = new GoogleMeetService(
      options.databaseAdapter,
      root,
      async () => ({ text: "Speech" }),
      () => null
    );

    try {
      const app = createHonoApp({ ...options, googleMeetService });

      const session = await setupFreshInstallSession(
        app,
        options.databaseAdapter
      );

      const user =
        await options.databaseAdapter.getUserByEmail("admin@example.com");

      const request = (action: string, input = {}) =>
        app.fetch(
          new Request(`http://localhost:4310/v1/meet/actions/${action}`, {
            body: JSON.stringify(input),
            headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
            method: "POST",
          })
        );

      expect((await request("meetings")).status).toBe(200);
      expect(
        (await request("meetings", { actorId: "someone-else" })).status
      ).toBe(400);
      expect((await request("toString")).status).toBe(404);
      await options.databaseAdapter.upsertOrgMember({
        createdAt: new Date().toISOString(),
        orgId: session.orgId,
        role: "member",
        userId: user!.id,
      });
      expect((await request("meetings")).status).toBe(200);
      expect((await request("configure", { enabled: false })).status).toBe(403);
      await options.databaseAdapter.deleteOrgMember(session.orgId, user!.id);
      expect((await request("meetings")).status).toBe(403);
      expect(
        (await request("upload", { content: "YQ==", filename: "notes.md" }))
          .status
      ).toBe(403);
    } finally {
      await googleMeetService.close();
      await rm(root, { force: true, recursive: true });
    }
  });
  test("rejects oversized request bodies before public route handlers", async () => {
    const app = createHonoApp(createServerOptions());

    const defaultLimitResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: "{}",
        headers: {
          "Content-Length": String(DEFAULT_HTTP_REQUEST_BODY_LIMIT_BYTES + 1),
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(defaultLimitResponse.status).toBe(413);

    const importWithinLimitResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: "{}",
        headers: {
          "Content-Length": String(DEFAULT_HTTP_REQUEST_BODY_LIMIT_BYTES + 1),
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(importWithinLimitResponse.status).toBe(400);

    const importLimitResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: "{}",
        headers: {
          "Content-Length": String(MAX_HTTP_REQUEST_BODY_LIMIT_BYTES + 1),
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(importLimitResponse.status).toBe(413);
  });

  test("knowledge uploads allow a base64-encoded 20 MiB document through the body limit", async () => {
    const app = createHonoApp(createServerOptions());

    const request = (size: number) =>
      new Request("http://localhost:4310/v1/profiles/example/knowledge-base", {
        body: "{}",
        headers: {
          "Content-Length": String(size),
          "Content-Type": "application/json",
        },
        method: "POST",
      });

    expect(
      (await app.fetch(request(Math.ceil((20 * 1024 * 1024) / 3) * 4 + 1024)))
        .status
    ).not.toBe(413);
    expect((await app.fetch(request(30 * 1024 * 1024 + 1))).status).toBe(413);
  });

  test("liveness stays up while readiness tracks a closed and reopened database", async () => {
    const database = await createSqliteDatabase(":memory:");

    const { app } = createMinimalHonoApp({
      databaseAdapter: database.adapter,
    });

    try {
      expect((await app.request("/up")).status).toBe(200);
      expect((await app.request("/healthz")).status).toBe(200);
      expect((await app.request("/readyz")).status).toBe(200);
      await database.close();
      const unavailable = await app.request("/readyz");
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ ok: false });
      expect((await app.request("/healthz")).status).toBe(200);
      await database.reopen();
      expect((await app.request("/readyz")).status).toBe(200);
    } finally {
      await database.close();
    }
  });

  test("opt-in metrics and JSON logs correlate requests without logging URL secrets", async () => {
    const previous = {
      format: process.env.NAKAMA_LOG_FORMAT,
      level: process.env.NAKAMA_LOG_LEVEL,
      metrics: process.env.NAKAMA_METRICS,
    };

    const output = spyOn(console, "log").mockImplementation(() => {});

    try {
      delete process.env.NAKAMA_METRICS;
      expect(
        (await createMinimalHonoApp().app.request("/metrics")).status
      ).toBe(404);
      process.env.NAKAMA_METRICS = "true";
      process.env.NAKAMA_LOG_FORMAT = "json";
      process.env.NAKAMA_LOG_LEVEL = "debug";
      output.mockClear();

      const { app, databaseAdapter } = createMinimalHonoApp({
        webDistDir: resolve(import.meta.dir, "../../../web"),
      });

      const response = await app.request("/v1/private-secret?token=hidden", {
        headers: { "X-Request-Id": "probe-123" },
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("X-Request-Id")).toBe("probe-123");

      const records = output.mock.calls.map(([line]) =>
        JSON.parse(String(line))
      );

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        message: "http.request",
        method: "GET",
        requestId: "probe-123",
      });
      expect(JSON.stringify(records)).not.toContain("private-secret");
      expect(JSON.stringify(records)).not.toContain("hidden");

      const generated = await app.request("/healthz", {
        headers: { "X-Request-Id": "x".repeat(300) },
      });

      expect(generated.headers.get("X-Request-Id")).toHaveLength(36);
      const metrics = await app.request("/metrics");
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("Content-Type")).toContain("text/plain");
      expect(await metrics.text()).toContain("nakama_http_requests_total 2");

      process.env.NAKAMA_LOG_LEVEL = "warn";
      output.mockClear();
      await app.request("/healthz");
      expect(output).not.toHaveBeenCalled();

      const failure = spyOn(
        databaseAdapter,
        "countHumanUsers"
      ).mockRejectedValue(new Error("database unavailable"));

      try {
        const error = await app.request("/health", {
          headers: { "X-Request-Id": "failed-probe" },
        });

        expect(error.status).toBe(500);
        expect(error.headers.get("X-Request-Id")).toBe("failed-probe");
        expect(output).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
          level: "error",
          requestId: "failed-probe",
          status: 500,
        });
        expect(await (await app.request("/metrics")).text()).toContain(
          "nakama_http_server_errors_total 1"
        );
      } finally {
        failure.mockRestore();
      }
    } finally {
      output.mockRestore();

      for (const [key, value] of [
        ["NAKAMA_METRICS", previous.metrics],
        ["NAKAMA_LOG_FORMAT", previous.format],
        ["NAKAMA_LOG_LEVEL", previous.level],
      ]) {
        if (value === undefined) {
          delete process.env[key!];
        } else {
          process.env[key!] = value;
        }
      }
    }
  });

  test("accepts opaque bearer auth for internal clients", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-bearer-auth-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const token = await loadLocalAuthToken();
      const payload = await verifyLocalAuthToken(token!);
      expect(payload).not.toBeNull();
      await seedLocalClientUser(options.databaseAdapter);
      await seedOrgForUser(options.databaseAdapter, payload!.email);
      const app = createHonoApp(options);

      const profilesResponse = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Org-Id": TEST_ORG_ID,
          },
        })
      );

      expect(profilesResponse.status).toBe(200);
      await expect(profilesResponse.json()).resolves.toEqual({
        profiles: [{ id: "default" }],
      });

      const whatsappResponse = await app.fetch(
        new Request(
          "http://localhost:4310/v1/settings/whatsapp?profileId=default",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Org-Id": TEST_ORG_ID,
            },
          }
        )
      );

      expect(whatsappResponse.status).toBe(200);
      await expect(whatsappResponse.json()).resolves.toEqual({
        enabled: false,
      });
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("auto-provisions local client user on first bearer auth", async () => {
    const configDir = await mkdtemp(
      join(tmpdir(), "nakama-bearer-auth-autoprovision-")
    );

    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const token = await loadLocalAuthToken();
      const now = new Date().toISOString();
      await options.databaseAdapter.upsertOrganization({
        createdAt: now,
        id: TEST_ORG_ID,
        name: "Test Org",
        slug: "test-org",
        updatedAt: now,
      });
      const app = createHonoApp(options);

      expect(
        await options.databaseAdapter.getUserByEmail(LOCAL_CLIENT_EMAIL)
      ).toBeNull();

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: { Authorization: `Bearer ${token}` },
        })
      );

      expect(response.status).toBe(200);
      expect(
        await options.databaseAdapter.getUserByEmail(LOCAL_CLIENT_EMAIL)
      ).not.toBeNull();
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("resolves org context for bearer auth without X-Org-Id", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-bearer-auth-org-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const token = await loadLocalAuthToken();
      await seedLocalClientUser(options.databaseAdapter);
      await seedOrgForUser(options.databaseAdapter, LOCAL_CLIENT_EMAIL);
      const app = createHonoApp(options);

      const profilesResponse = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: { Authorization: `Bearer ${token}` },
        })
      );

      expect(profilesResponse.status).toBe(200);
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("rejects invalid bearer auth with 401 instead of 500", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: { Authorization: "Bearer invalid_token" },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  test("allows blob: media and PDFs so authenticated previews can render", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: { Authorization: "Bearer invalid_token" },
      })
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(
      "img-src 'self' data: blob: https://logos.composio.dev;"
    );
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("object-src blob:");
    expect(csp).toContain("frame-src 'self' blob:");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(csp).not.toContain("frame-ancestors");
  });
});
