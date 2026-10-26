import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadLocalAuthToken } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import {
  buildSetupAuthBody,
  LOCAL_CLIENT_EMAIL,
  seedLocalClientUser,
  seedOrgForUser,
  withOrgId,
} from "./test-org-helpers";
import {
  cookieHeaderFromSetCookies,
  cookieValue,
  extractSetCookies,
  loginUserSession,
} from "./test-session-helpers";

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
  test("serves the artifact frame with its own CSP so artifact scripts run", async () => {
    // With a web dist the SPA fallback must not swallow the frame path.
    const app = createHonoApp({
      ...createServerOptions(),
      webDistDir: resolve(import.meta.dir, "../../../web"),
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/artifact-frame")
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("nakama-artifact-frame-ready");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(response.headers.get("X-Frame-Options")).toBeNull();

    const directives = new Map(
      csp.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);

        return [name, values];
      })
    );

    expect(directives.get("script-src")).toEqual([
      "'unsafe-inline'",
      "https://cdnjs.cloudflare.com",
      "https://cdn.jsdelivr.net",
      "https://unpkg.com",
      "https://cdn.tailwindcss.com",
      "https://code.jquery.com",
    ]);
    expect(directives.get("style-src")).toEqual([
      "'unsafe-inline'",
      "data:",
      "https://fonts.googleapis.com",
    ]);
    expect(directives.get("font-src")).toEqual(["https://fonts.gstatic.com"]);
    expect(directives.get("img-src")).toEqual(["data:"]);
    expect(directives.get("media-src")).toEqual(["data:"]);

    for (const name of [
      "default-src",
      "connect-src",
      "frame-src",
      "object-src",
      "worker-src",
      "base-uri",
      "form-action",
    ]) {
      expect(directives.get(name)).toEqual(["'none'"]);
    }

    expect(directives.get("sandbox")).toEqual([
      "allow-scripts",
      "allow-modals",
    ]);
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=()"
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  test("allows HTML-sized playground requests through the body gate", async () => {
    const app = createHonoApp(createServerOptions());

    for (const toolId of ["tool_write_file", "tool_edit_file"]) {
      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/tools/${toolId}/run`, {
          body: "{}",
          headers: {
            "Content-Length": "16001000",
            "Content-Type": "application/json",
          },
          method: "POST",
        })
      );

      expect(response.status).toBe(401);
    }
  });

  test("allows the docs scripts on both docs paths", async () => {
    const app = createHonoApp(createServerOptions());

    for (const path of ["/docs", "/docs/"]) {
      const response = await app.fetch(
        new Request(`http://localhost:4310${path}`)
      );

      expect(response.status).toBe(200);
      const html = await response.text();
      const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      const scriptUrl = html.match(/<script src="([^"]+)"/)?.[1];
      expect(inlineScript).toBeDefined();
      expect(scriptUrl).toBeDefined();

      const hash = new Bun.CryptoHasher("sha256")
        .update(inlineScript!)
        .digest("base64");

      const csp = response.headers.get("Content-Security-Policy") ?? "";

      const scriptSrc =
        csp
          .split(";")
          .find((directive) => directive.trim().startsWith("script-src")) ?? "";

      expect(scriptSrc).toContain(scriptUrl!);
      expect(scriptSrc).toContain(`'sha256-${hash}'`);
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      expect(csp).toContain("font-src 'self' data: https://fonts.scalar.com;");
      expect(csp).toContain(
        "connect-src 'self' https://cdn.jsdelivr.net/sm/ https://api.scalar.com/vector/registry/;"
      );
    }
  });

  test("keeps Scalar resource permissions off other paths", async () => {
    const app = createHonoApp(createServerOptions());

    for (const path of ["/health", "/openapi.json", "/docs-other"]) {
      const response = await app.fetch(
        new Request(`http://localhost:4310${path}`)
      );

      const csp = response.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("font-src 'self' data:;");
      expect(csp).toContain("connect-src 'self';");
      expect(csp).not.toContain("scalar.com");
      expect(csp).not.toContain("jsdelivr.net");
    }
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
      // SAFETY: The test checks this response against the endpoint contract asserted below.
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

  test("local-token requests without X-Org-Id resolve only with a single membership", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-local-token-orgs-"));

    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const token = await loadLocalAuthToken();
      const options = createServerOptions();
      await seedLocalClientUser(options.databaseAdapter);
      const app = createHonoApp(options);
      const url = "http://localhost:4310/v1/profiles";

      // No membership: nothing to fall back to.
      const none = await app.fetch(
        new Request(url, { headers: { Authorization: `Bearer ${token}` } })
      );

      expect(none.status).toBe(400);

      await expect(none.json()).resolves.toEqual({
        error: "Organization context required",
      });

      // One membership: unambiguous fallback keeps single-org CLI working.
      await seedOrgForUser(options.databaseAdapter, LOCAL_CLIENT_EMAIL);

      const single = await app.fetch(
        new Request(url, { headers: { Authorization: `Bearer ${token}` } })
      );

      expect(single.status).toBe(200);

      // Two memberships: a silent pick would target an org the caller never
      // chose, so the request must fail like a cookie session without an org.
      // (seedOrgForUser cannot add a second org — its slug fallback resolves
      // back to the first one — so seed this membership directly.)
      const secondOrgAt = new Date().toISOString();

      await options.databaseAdapter.upsertOrganization({
        createdAt: secondOrgAt,
        id: "org_test_second",
        name: "Test Org Second",
        slug: "test-org-second",
        updatedAt: secondOrgAt,
      });

      await options.databaseAdapter.upsertOrgMember({
        createdAt: secondOrgAt,
        orgId: "org_test_second",
        role: "admin",
        userId: LOCAL_CLIENT_USER_ID,
      });

      const multi = await app.fetch(
        new Request(url, { headers: { Authorization: `Bearer ${token}` } })
      );

      expect(multi.status).toBe(400);

      await expect(multi.json()).resolves.toEqual({
        error: "Organization context required",
      });

      // Explicit header keeps working across memberships.
      const explicit = await app.fetch(
        new Request(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Org-Id": "org_test_second",
          },
        })
      );

      expect(explicit.status).toBe(200);
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
});
