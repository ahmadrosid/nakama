import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import {
  buildSetupAuthBody,
  createPlatformAdminUser,
  withOrgId,
} from "./test-org-helpers";
import {
  cookieHeaderFromSetCookies,
  cookieValue,
  extractSetCookies,
  setupFreshInstallSession,
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
  describe("org context middleware", () => {
    test("setup stores active org on the session", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);

      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify(buildSetupAuthBody()),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(setupResponse.status).toBe(201);

      // SAFETY: The test checks this response against the endpoint contract asserted below.
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
          headers: { "Content-Type": "application/json" },
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
  });

  describe("auth request bodies", () => {
    test("rejects wrong-typed setup fields before invoking auth services", async () => {
      const app = createHonoApp(createServerOptions());

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify({
            admin: {
              email: "admin@example.com",
              name: true,
              password: "password123",
            },
            organization: { name: "Acme", slug: "acme" },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(response.status).toBe(400);
    });

    test("rejects missing required setup fields", async () => {
      const app = createHonoApp(createServerOptions());

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: JSON.stringify({
            admin: {
              email: "admin@example.com",
              name: "Admin",
            },
            organization: { name: "Acme", slug: "acme" },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(response.status).toBe(400);
    });

    test("keeps malformed auth JSON as a bad request", async () => {
      const app = createHonoApp(createServerOptions());

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          body: "{",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(response.status).toBe(400);
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

      // SAFETY: The test checks this response against the endpoint contract asserted below.
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
        new Request("http://localhost:4310/v1/profiles/default/move", {
          body: JSON.stringify({ organizationId: "other" }),
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

      expect(skillsResponse.status).toBe(200);
    });
    test("returns generic passkey options without authentication", async () => {
      const app = createHonoApp(createServerOptions());

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/passkey/login/options", {
          body: "{}",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(response.status).toBe(200);

      // SAFETY: The test checks this response against the endpoint contract asserted below.
      const body = (await response.json()) as {
        challenge: string;
        options: { allowCredentials?: unknown };
        totpEnabled?: unknown;
      };

      expect(body.challenge).toBeString();
      expect(body.options.allowCredentials).toBeUndefined();
      expect(body.totpEnabled).toBeUndefined();
    });
  });
});
