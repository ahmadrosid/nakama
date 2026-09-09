import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadLocalAuthToken, verifyLocalAuthToken } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
} from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import {
  createHonoApp,
  DEFAULT_HTTP_REQUEST_BODY_LIMIT_BYTES,
  MAX_HTTP_REQUEST_BODY_LIMIT_BYTES,
} from "./app";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  buildSetupAuthBody,
  createPlatformAdminUser,
  LOCAL_CLIENT_EMAIL,
  seedLocalClientUser,
  seedOrgForUser,
  TEST_ORG_ID,
  withOrgId,
} from "./test-org-helpers";
import {
  cookieHeaderFromSetCookies,
  cookieValue,
  extractSetCookies,
  loginUserSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-http-app-test-");

async function withNodeEnv<T>(env: string, run: () => Promise<T>): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    return await run();
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
}

function expectCookiesSecure(setCookies: string[], expected: boolean): void {
  expect(setCookies.length).toBeGreaterThan(0);
  expect(
    setCookies.every((cookie) =>
      expected
        ? /;\s*Secure(?:;|$)/i.test(cookie)
        : !/;\s*Secure(?:;|$)/i.test(cookie)
    )
  ).toBe(true);
}

function createServerOptions() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    agent: {
      beginSessionTurn: async () => true,
      createSession: async () => "session_1",
      getWhatsAppSettings: async () => ({ enabled: false }),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      listSessions: async (
        _orgId: string,
        profileId: string,
        channel: string
      ) => ({
        sessions: [{ id: `${profileId}-${channel}` }],
      }),
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

  test("liveness stays up while readiness tracks a closed and reopened database", async () => {
    const database = await createSqliteDatabase(":memory:");
    const { app } = createMinimalHonoApp({
      databaseAdapter: database.adapter,
      webDistDir: resolve(import.meta.dir, "../../../web"),
    });
    try {
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
        new Request("http://localhost:4310/v1/settings/whatsapp", {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Org-Id": TEST_ORG_ID,
          },
        })
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

  test("allows blob: media so authenticated artifact previews can render", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: { Authorization: "Bearer invalid_token" },
      })
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self' blob:");
  });

  test("allows the theme bootstrap by hash instead of every inline script", async () => {
    const indexHtml = await Bun.file(
      resolve(import.meta.dir, "../../../web/index.html")
    ).text();
    const inlineScript = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!inlineScript) {
      throw new Error("apps/web/index.html no longer inlines a script");
    }
    const hash = new Bun.CryptoHasher("sha256")
      .update(inlineScript)
      .digest("base64");

    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: { Authorization: "Bearer invalid_token" },
      })
    );

    const scriptSrc = (response.headers.get("Content-Security-Policy") ?? "")
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src"));
    expect(scriptSrc).toBe(`script-src 'self' 'sha256-${hash}'`);
  });

  test("logs in with a password that was set with surrounding whitespace", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-password-trim-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const app = createHonoApp(options);
      await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(
            buildSetupAuthBody("padded@example.com", {
              admin: { password: "  secret123  " },
            })
          ),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      const loginResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/login", {
          body: JSON.stringify({
            email: "padded@example.com",
            password: "  secret123  ",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(loginResponse.status).toBe(200);
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("rotates the local auth token from a browser session", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-rotate-auth-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(
            buildSetupAuthBody("admin@example.com", {
              admin: { password: "secret123" },
            })
          ),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );
      const setupCookies = extractSetCookies(setupResponse);
      const orgId = await seedOrgForUser(
        options.databaseAdapter,
        "admin@example.com"
      );

      const rotateResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/local-token/rotate", {
          headers: withOrgId(
            {
              Cookie: cookieHeaderFromSetCookies(setupCookies),
              "X-CSRF-Token": cookieValue(setupCookies, "nakama_csrf"),
            },
            orgId
          ),
          method: "POST",
        })
      );

      expect(rotateResponse.status).toBe(200);
      const rotatePayload = (await rotateResponse.json()) as { token: string };
      expect(rotatePayload.token).toStartWith("tc_local_");

      const oldToken = await loadLocalAuthToken();
      expect(oldToken).toBe(rotatePayload.token);
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("rejects local auth token rotation from bearer auth", async () => {
    const configDir = await mkdtemp(
      join(tmpdir(), "nakama-rotate-auth-bearer-")
    );
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const token = await loadLocalAuthToken();
      const options = createServerOptions();
      await seedLocalClientUser(options.databaseAdapter);
      const app = createHonoApp(options);
      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/local-token/rotate", {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        })
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Sign in through the dashboard to rotate the local auth token.",
      });
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("rejects local auth token rotation for non-platform-admin browser sessions", async () => {
    const configDir = await mkdtemp(
      join(tmpdir(), "nakama-rotate-auth-member-")
    );
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(
            buildSetupAuthBody("admin@example.com", {
              admin: { password: "secret123" },
            })
          ),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );
      expect(setupResponse.status).toBe(201);
      const orgId = await seedOrgForUser(
        options.databaseAdapter,
        "admin@example.com"
      );

      const now = new Date().toISOString();
      await options.databaseAdapter.createUser({
        createdAt: now,
        email: "member@example.com",
        id: "user_member_rotate",
        passwordHash: await options.authService.hashPassword("secret123"),
        updatedAt: now,
      });
      await options.databaseAdapter.upsertOrgMember({
        createdAt: now,
        orgId,
        role: "member",
        userId: "user_member_rotate",
      });

      const member = await loginUserSession(
        app,
        "member@example.com",
        "secret123",
        orgId
      );

      const rotateResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/local-token/rotate", {
          headers: member.headers({ "X-CSRF-Token": member.csrfToken }),
          method: "POST",
        })
      );

      expect(rotateResponse.status).toBe(403);
      await expect(rotateResponse.json()).resolves.toEqual({
        error: "Forbidden",
      });
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("serves health through the Hono fetch boundary", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(
      new Request("http://localhost:4310/health")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      // /health stays local — never probes Composio reachability
      composioAvailable: false,
      ok: true,
      providerConfigured: true,
      userConfigured: false,
      version: expect.any(String),
    });
  });

  test("reports userConfigured when only the local CLI client exists", async () => {
    const options = createServerOptions();
    await seedLocalClientUser(options.databaseAdapter);
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/health")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      userConfigured: false,
    });
  });

  test("allows setup when only the local CLI client exists", async () => {
    const options = createServerOptions();
    await seedLocalClientUser(options.databaseAdapter);
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        body: JSON.stringify(buildSetupAuthBody()),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
  });

  const secureCookieCases = [
    {
      expectSecure: false,
      headers: { "Content-Type": "application/json" },
      name: "setup over HTTP does not set Secure cookies even in production (#112)",
      nodeEnv: "production",
      url: "http://localhost:4310/v1/auth/setup",
      verifySession: true,
    },
    {
      expectSecure: true,
      headers: { "Content-Type": "application/json" },
      name: "setup over HTTPS sets Secure cookies in production",
      nodeEnv: "production",
      url: "https://nakama.example/v1/auth/setup",
    },
    {
      expectSecure: true,
      headers: { "Content-Type": "application/json" },
      name: "setup over HTTPS sets Secure cookies even when NODE_ENV is not production",
      nodeEnv: "development",
      url: "https://nakama.example/v1/auth/setup",
    },
    {
      expectSecure: true,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
      },
      name: "setup behind HTTPS proxy sets Secure cookies via X-Forwarded-Proto",
      nodeEnv: "production",
      url: "http://localhost:4310/v1/auth/setup",
    },
    {
      expectSecure: true,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "http",
      },
      name: "https request URL keeps Secure cookies even if X-Forwarded-Proto is http",
      nodeEnv: "production",
      url: "https://nakama.example/v1/auth/setup",
    },
  ] as const;

  for (const tc of secureCookieCases) {
    test(tc.name, async () => {
      await withNodeEnv(tc.nodeEnv, async () => {
        const options = createServerOptions();
        const app = createHonoApp(options);
        const setupResponse = await app.fetch(
          new Request(tc.url, {
            body: JSON.stringify(
              buildSetupAuthBody("admin@example.com", {
                admin: { password: "secret123" },
              })
            ),
            headers: { ...tc.headers },
            method: "POST",
          })
        );

        expect(setupResponse.status).toBe(201);
        const setCookies = extractSetCookies(setupResponse);
        expectCookiesSecure(setCookies, tc.expectSecure);

        if ("verifySession" in tc && tc.verifySession) {
          const meResponse = await app.fetch(
            new Request("http://localhost:4310/v1/auth/me", {
              headers: { Cookie: cookieHeaderFromSetCookies(setCookies) },
            })
          );
          expect(meResponse.status).toBe(200);
        }
      });
    });
  }

  test("a rejected setup leaves no organization behind", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const setup = (email: string) =>
      app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(
            buildSetupAuthBody(email, {
              organization: { name: "Acme", slug: "acme" },
            })
          ),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

    expect((await setup("not-an-email")).status).toBe(400);
    expect(await options.databaseAdapter.listOrganizations()).toHaveLength(0);

    // The org used to be committed before the admin was validated, so the
    // retry lost the slug it had just taken.
    expect((await setup("admin@example.com")).status).toBe(201);
  });

  test("concurrent setup creates exactly one org and one admin", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const setup = (slug: string) =>
      app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(
            buildSetupAuthBody(`${slug}@example.com`, {
              organization: { name: slug, slug },
            })
          ),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

    // Distinct slugs, so nothing but the human-user check can stop the loser.
    const statuses = (await Promise.all([setup("alpha"), setup("beta")])).map(
      (response) => response.status
    );

    expect(statuses.toSorted()).toEqual([201, 409]);
    expect(await options.databaseAdapter.countHumanUsers()).toBe(1);

    const organizations = await options.databaseAdapter.listOrganizations();
    expect(organizations).toHaveLength(1);
    const members = await options.databaseAdapter.listOrgMembers(
      organizations[0]?.id ?? ""
    );
    expect(
      members.filter((member) => member.userId !== LOCAL_CLIENT_USER_ID)
    ).toHaveLength(1);
  });

  test("sends HSTS behind a TLS terminator", async () => {
    const app = createHonoApp(createServerOptions());

    const response = await app.fetch(
      new Request("http://localhost:4310/health", {
        headers: { "X-Forwarded-Proto": "https" },
      })
    );

    expect(response.headers.get("Strict-Transport-Security")).toContain(
      "max-age="
    );
  });

  test("login rejects a body that is not application/json", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    await setupFreshInstallSession(app, options.databaseAdapter);

    // A cross-site form can send text/plain without a CORS preflight, which is
    // how a page logs a victim into an account it controls.
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password123",
        }),
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        method: "POST",
      })
    );

    expect(response.status).toBe(415);
  });

  test("logout clears both Secure and non-Secure session cookies", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        body: JSON.stringify(
          buildSetupAuthBody("admin@example.com", {
            admin: { password: "secret123" },
          })
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(setupResponse.status).toBe(201);
    const session = {
      cookieHeader: cookieHeaderFromSetCookies(
        extractSetCookies(setupResponse)
      ),
      csrfToken: cookieValue(extractSetCookies(setupResponse), "nakama_csrf"),
    };

    const logoutResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/logout", {
        headers: {
          Cookie: session.cookieHeader,
          "X-CSRF-Token": session.csrfToken,
        },
        method: "POST",
      })
    );

    expect(logoutResponse.status).toBe(200);
    const clearCookies = extractSetCookies(logoutResponse);
    const sessionClears = clearCookies.filter((cookie) =>
      cookie.startsWith("nakama_session=")
    );
    const csrfClears = clearCookies.filter((cookie) =>
      cookie.startsWith("nakama_csrf=")
    );
    expect(
      sessionClears.some((cookie) => /;\s*Secure(?:;|$)/i.test(cookie))
    ).toBe(true);
    expect(
      sessionClears.some((cookie) => !/;\s*Secure(?:;|$)/i.test(cookie))
    ).toBe(true);
    expect(csrfClears.some((cookie) => /;\s*Secure(?:;|$)/i.test(cookie))).toBe(
      true
    );
    expect(
      csrfClears.some((cookie) => !/;\s*Secure(?:;|$)/i.test(cookie))
    ).toBe(true);
  });

  test("requires platform admin to control messaging workers", async () => {
    const options = createServerOptions();
    const calls: string[] = [];
    options.workerManager.startWorker = async (name: string) => {
      calls.push(`start:${name}`);
    };
    options.workerManager.stopWorker = async (name: string) => {
      calls.push(`stop:${name}`);
    };
    const app = createHonoApp(options);
    const platformSession = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );
    const now = new Date().toISOString();

    await options.databaseAdapter.createUser({
      createdAt: now,
      email: "org-admin-worker@example.com",
      id: "user_org_admin_worker",
      passwordHash: await options.authService.hashPassword("password123"),
      updatedAt: now,
    });
    await options.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: platformSession.orgId!,
      role: "admin",
      userId: "user_org_admin_worker",
    });

    const orgAdminSession = await loginUserSession(
      app,
      "org-admin-worker@example.com",
      "password123",
      platformSession.orgId
    );
    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/start", {
        headers: orgAdminSession.headers({
          "X-CSRF-Token": orgAdminSession.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(denied.status).toBe(403);
    expect(calls).toEqual([]);

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/workers/telegram/stop", {
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(allowed.status).toBe(200);
    expect(calls).toEqual(["stop:telegram"]);
  });

  test("creates and lists sessions through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/sessions", {
        body: JSON.stringify({ channel: "web", profileId: "default" }),
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({
      sessionId: "session_1",
    });

    const listResponse = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=default&channel=web",
        {
          headers: session.headers(),
        }
      )
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [{ id: "default-web" }],
    });
  });

  test("GET /v1/sessions rejects missing or invalid channel", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );
    const listCalls: Array<{ channel: string; profileId: string }> = [];
    const originalListSessions = options.agent.listSessions;
    options.agent.listSessions = async (orgId, profileId, channel) => {
      listCalls.push({ channel, profileId });
      return originalListSessions(orgId, profileId, channel);
    };

    const missingChannel = await app.fetch(
      new Request("http://localhost:4310/v1/sessions?profileId=default", {
        headers: session.headers(),
      })
    );
    expect(missingChannel.status).toBe(400);
    await expect(missingChannel.json()).resolves.toMatchObject({
      error: expect.any(String),
    });

    const invalidChannel = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=default&channel=not-a-channel",
        {
          headers: session.headers(),
        }
      )
    );
    expect(invalidChannel.status).toBe(400);
    await expect(invalidChannel.json()).resolves.toMatchObject({
      error: expect.any(String),
    });

    expect(listCalls).toEqual([]);
  });

  describe("org context middleware", () => {
    test("setup stores active org on the session", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(buildSetupAuthBody()),
          method: "POST",
        })
      );

      expect(setupResponse.status).toBe(201);
      const setupBody = (await setupResponse.json()) as {
        activeOrgId: string;
        orgId: string;
      };
      expect(setupBody.activeOrgId).toStartWith("org_");
      expect(setupBody.orgId).toBe(setupBody.activeOrgId);

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: {
            Cookie: cookieHeaderFromSetCookies(
              extractSetCookies(setupResponse)
            ),
          },
        })
      );

      expect(response.status).toBe(200);
    });

    test("returns 400 when org context is missing on protected routes", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const now = new Date().toISOString();
      await options.databaseAdapter.createUser({
        createdAt: now,
        email: "noorg@example.com",
        id: "user_no_org",
        passwordHash: await options.authService.hashPassword("password123"),
        updatedAt: now,
      });

      const loginResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/login", {
          body: JSON.stringify({
            email: "noorg@example.com",
            password: "password123",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: {
            Cookie: cookieHeaderFromSetCookies(
              extractSetCookies(loginResponse)
            ),
          },
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Organization context required",
      });
    });

    test("returns 404 when org membership is missing", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await setupFreshInstallSession(
        app,
        options.databaseAdapter
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: withOrgId(session.headers(), "org_other"),
        })
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Not found" });
    });

    test("skips org context for auth routes", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(buildSetupAuthBody()),
          method: "POST",
        })
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/me", {
          headers: {
            Cookie: cookieHeaderFromSetCookies(
              extractSetCookies(setupResponse)
            ),
          },
        })
      );

      expect(response.status).toBe(200);
    });

    test("returns 403 when viewers mutate protected routes", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await setupFreshInstallSession(
        app,
        options.databaseAdapter,
        "viewer@example.com",
        "viewer"
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/workers/automation/start", {
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        })
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    });

    test("returns 403 when viewers send session messages", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await setupFreshInstallSession(
        app,
        options.databaseAdapter,
        "viewer@example.com",
        "viewer"
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/sessions/session_1/messages", {
          body: JSON.stringify({ message: "hello" }),
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        })
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    });
  });

  describe("platform admin routes", () => {
    test("allows profile list for org members but blocks profile management", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      await createPlatformAdminUser(
        options.databaseAdapter,
        options.authService
      );

      const platformLogin = await app.fetch(
        new Request("http://localhost:4310/v1/auth/login", {
          body: JSON.stringify({
            email: "platform@example.com",
            password: "password123",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );
      expect(platformLogin.status).toBe(200);
      const platformCookies = extractSetCookies(platformLogin);

      const createOrgResponse = await app.fetch(
        new Request("http://localhost:4310/v1/platform/orgs", {
          body: JSON.stringify({
            admin: {
              email: "admin@acme.com",
              name: "Acme Admin",
              phone: "+628123456789",
            },
            name: "Acme",
            slug: "acme-platform-admin",
          }),
          headers: withOrgId(
            {
              Cookie: cookieHeaderFromSetCookies(platformCookies),
              "X-CSRF-Token": cookieValue(platformCookies, "nakama_csrf"),
            },
            ""
          ),
          method: "POST",
        })
      );
      expect(createOrgResponse.status).toBe(201);
      const created = (await createOrgResponse.json()) as {
        organization: { id: string };
        adminMember: { temporaryPassword: string };
      };

      const orgAdminLogin = await app.fetch(
        new Request("http://localhost:4310/v1/auth/login", {
          body: JSON.stringify({
            email: "admin@acme.com",
            password: created.adminMember.temporaryPassword,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );
      expect(orgAdminLogin.status).toBe(200);
      const orgAdminCookies = extractSetCookies(orgAdminLogin);
      const orgHeaders = {
        Cookie: cookieHeaderFromSetCookies(orgAdminCookies),
        "X-Org-Id": created.organization.id,
      };

      const listResponse = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: orgHeaders,
        })
      );
      expect(listResponse.status).toBe(200);

      const createProfileResponse = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          body: JSON.stringify({ name: "Blocked", systemPrompt: "nope" }),
          headers: {
            ...orgHeaders,
            "Content-Type": "application/json",
            "X-CSRF-Token": cookieValue(orgAdminCookies, "nakama_csrf"),
          },
          method: "POST",
        })
      );
      expect(createProfileResponse.status).toBe(403);

      const soulResponse = await app.fetch(
        new Request("http://localhost:4310/v1/profiles/default/soul", {
          headers: orgHeaders,
        })
      );
      expect(soulResponse.status).toBe(403);

      const skillsResponse = await app.fetch(
        new Request("http://localhost:4310/v1/skills", { headers: orgHeaders })
      );
      expect(skillsResponse.status).toBe(403);
    });
  });
});
