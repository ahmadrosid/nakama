import { describe, expect, test } from "bun:test";
import type { HealthResponse } from "@nakama/core/contract";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import { buildSetupAuthBody, seedLocalClientUser } from "./test-org-helpers";
import {
  cookieHeaderFromSetCookies,
  cookieValue,
  extractSetCookies,
  setupFreshInstallSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-http-app-test-");

async function withNodeEnv<T>(env: string, run: () => Promise<T>): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", env);

  try {
    return await run();
  } finally {
    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
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

  // SAFETY: The test checks this response against the endpoint contract asserted below.
  return {
    agent: {
      assertSessionProfileAccess: async () => {},
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
      turns: {
        start: async (
          _sessionId: string,
          _orgId: string,
          input: { message: string }
        ) => ({
          done: Promise.resolve({
            kind: "done",
            reply: `reply:${input.message}`,
          }),
          status: "started",
        }),
      },
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

  test("reports onboarding off unless NAKAMA_ENABLE_ONBOARDING is on", async () => {
    const previous = process.env.NAKAMA_ENABLE_ONBOARDING;
    const app = createHonoApp(createServerOptions());

    const readFlag = async () => {
      const response = await app.fetch(
        new Request("http://localhost:4310/health")
      );

      // SAFETY: /health always answers with the HealthResponse schema.
      const body = (await response.json()) as HealthResponse;

      return body.onboardingEnabled;
    };

    try {
      delete process.env.NAKAMA_ENABLE_ONBOARDING;
      expect(await readFlag()).toBe(false);

      process.env.NAKAMA_ENABLE_ONBOARDING = "true";
      expect(await readFlag()).toBe(true);

      process.env.NAKAMA_ENABLE_ONBOARDING = "1";
      expect(await readFlag()).toBe(true);

      process.env.NAKAMA_ENABLE_ONBOARDING = "no";
      expect(await readFlag()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_ENABLE_ONBOARDING;
      } else {
        process.env.NAKAMA_ENABLE_ONBOARDING = previous;
      }
    }
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

  test("setup rejects a body that is not application/json", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        body: JSON.stringify(buildSetupAuthBody("admin@example.com")),
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        method: "POST",
      })
    );

    expect(response.status).toBe(415);
    expect(extractSetCookies(response)).toEqual([]);
    expect(await options.databaseAdapter.countHumanUsers()).toBe(0);
    expect(await options.databaseAdapter.listOrganizations()).toEqual([]);
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
  test("accept-invite rejects a body that is not application/json", async () => {
    const options = createServerOptions();
    options.orgService = new OrgService(
      options.databaseAdapter,
      options.authService,
      { send: async () => ({ error: "Email unavailable.", ok: false }) }
    );
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const admin =
      await options.databaseAdapter.getUserByEmail("admin@example.com");

    const invite = await options.orgService.createInvite({
      email: "invitee@example.com",
      invitedByUserId: admin!.id,
      orgId: session.orgId!,
      role: "member",
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/accept-invite", {
        body: JSON.stringify({ password: "secret123", token: invite.token }),
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        method: "POST",
      })
    );

    expect(response.status).toBe(415);
    expect(extractSetCookies(response)).toEqual([]);

    const accepted = await app.fetch(
      new Request("http://localhost:4310/v1/auth/accept-invite", {
        body: JSON.stringify({ password: "secret123", token: invite.token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(accepted.status).toBe(200);
    expect(extractSetCookies(accepted).length).toBeGreaterThan(0);
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
    // The host-bound pair is Secure by definition and is cleared too, so a
    // session survives neither scheme on the same browser.
    expect(
      clearCookies.some((cookie) => cookie.startsWith("__Host-nakama_session="))
    ).toBe(true);
    expect(
      clearCookies.some((cookie) => cookie.startsWith("__Host-nakama_csrf="))
    ).toBe(true);
  });

  test("disconnect routes all agent channels to their scoped connection", async () => {
    const options = createServerOptions();

    const calls: Array<{
      name: string;
      owner: { orgId: string; profileId: string };
    }> = [];

    options.workerManager.disconnectChannel = async (
      name: string,
      owner: { orgId: string; profileId: string }
    ) => {
      calls.push({ name, owner });
    };

    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const disconnect = (path: string) =>
      app.fetch(
        new Request(`http://localhost:4310/v1/workers/${path}`, {
          headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
          method: "POST",
        })
      );

    for (const name of ["telegram", "discord", "whatsapp"]) {
      const response = await disconnect(`${name}/disconnect?profileId=default`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }

    expect(calls).toEqual(
      ["telegram", "discord", "whatsapp"].map((name) => ({
        name,
        owner: { orgId: session.orgId, profileId: "default" },
      }))
    );
    expect((await disconnect("discord/disconnect")).status).toBe(400);
    expect(
      (await disconnect("automation/disconnect?profileId=default")).status
    ).toBe(400);
    expect(calls).toHaveLength(3);
  });
});
