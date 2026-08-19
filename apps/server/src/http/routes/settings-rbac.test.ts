import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import type { ServerOptions } from "../context";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-settings-rbac-test-");

const ORG_ID = "org_settings_rbac";
const PASSWORD = "password123";

// Provider and channel settings are workspace-global: whoever writes them
// changes the config every org runs on.
const GLOBAL_WRITES: Array<{ body?: unknown; method: string; path: string }> = [
  { body: { provider: "openai" }, method: "POST", path: "/v1/providers" },
  {
    body: { baseUrl: "http://attacker.example.com/v1" },
    method: "PATCH",
    path: "/v1/providers/provider_1",
  },
  { method: "DELETE", path: "/v1/providers/provider_1" },
  {
    body: { apiKey: "sk-test", provider: "openai" },
    method: "PUT",
    path: "/v1/settings/provider",
  },
  { body: { provider: "openai" }, method: "POST", path: "/v1/models/discover" },
  {
    body: { timezone: "Asia/Jakarta" },
    method: "PUT",
    path: "/v1/settings/timezone",
  },
  { body: { enabled: true }, method: "PUT", path: "/v1/settings/vision" },
  {
    body: { enabled: true },
    method: "PUT",
    path: "/v1/settings/transcription",
  },
  {
    body: { enabled: true },
    method: "PUT",
    path: "/v1/settings/image-generation",
  },
  { body: { botToken: "t" }, method: "PUT", path: "/v1/settings/telegram" },
  {
    body: { botToken: "t" },
    method: "POST",
    path: "/v1/settings/telegram/handshake",
  },
  { body: { botToken: "d" }, method: "PUT", path: "/v1/settings/discord" },
  {
    body: { botToken: "d" },
    method: "POST",
    path: "/v1/settings/discord/handshake",
  },
  { body: { apiKey: "c" }, method: "PUT", path: "/v1/settings/composio" },
  { body: { enabled: true }, method: "PUT", path: "/v1/settings/whatsapp" },
  {
    body: { phoneNumber: "1" },
    method: "POST",
    path: "/v1/settings/whatsapp/pairing-code",
  },
  { method: "POST", path: "/v1/settings/whatsapp/reconnect" },
];

function createApp() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (..._args: unknown[]) => {
      calls.push(name);
      return {} as never;
    };
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({
    agent: {
      configureProvider: record("configureProvider"),
      createProvider: record("createProvider"),
      deleteProvider: record("deleteProvider"),
      discoverModels: record("discoverModels"),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      setComposioSettings: record("setComposioSettings"),
      setDiscordSettings: record("setDiscordSettings"),
      setImageGenerationSettings: record("setImageGenerationSettings"),
      setTelegramSettings: record("setTelegramSettings"),
      setTranscriptionSettings: record("setTranscriptionSettings"),
      setUserTimezone: record("setUserTimezone"),
      setVisionSettings: record("setVisionSettings"),
      setWhatsAppSettings: record("setWhatsAppSettings"),
      testDiscordSettings: record("testDiscordSettings"),
      testTelegramSettings: record("testTelegramSettings"),
      updateProvider: record("updateProvider"),
    } as unknown as ServerOptions["agent"],
    databaseAdapter,
    workerManager: {
      startWorker: record("startWorker"),
      stopWorker: record("stopWorker"),
    } as unknown as ServerOptions["workerManager"],
  });

  return { app, authService, calls, databaseAdapter };
}

async function login(role: OrgRole, isPlatformAdmin = false) {
  const { app, authService, calls, databaseAdapter } = createApp();
  const suffix = isPlatformAdmin ? "_platform" : "";
  const email = `${role}${suffix}@example.com`;
  const userId = `user_${role}${suffix}`;
  // The org needs an owner regardless; the user under test is seeded separately
  // so it can carry an arbitrary role and the platform-admin flag.
  await seedOrgAdmin(databaseAdapter, {
    authService,
    email: "owner@example.com",
    orgId: ORG_ID,
    password: PASSWORD,
    userId: "user_owner",
  });

  const now = new Date().toISOString();
  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id: userId,
    isPlatformAdmin,
    passwordHash: await authService.hashPassword(PASSWORD),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId: ORG_ID,
    role,
    userId,
  });

  const session = await loginUserSession(app, email, PASSWORD, ORG_ID);
  return { app, calls, session };
}

async function callRoute(
  app: { fetch: typeof fetch },
  session: {
    headers: (extra?: Record<string, string>) => Record<string, string>;
    csrfToken: string;
  },
  route: { body?: unknown; method: string; path: string }
) {
  return app.fetch(
    new Request(`http://localhost:4310${route.path}`, {
      body: route.body === undefined ? undefined : JSON.stringify(route.body),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: route.method,
    })
  );
}

describe("workspace-global settings writes require an org admin", () => {
  for (const route of GLOBAL_WRITES) {
    test(`${route.method} ${route.path} -> 403 for a viewer`, async () => {
      const { app, calls, session } = await login("viewer");
      const response = await callRoute(app, session, route);

      expect(response.status).toBe(403);
      // The guard must reject before the global config is touched.
      expect(calls).toEqual([]);
    });

    test(`${route.method} ${route.path} -> 403 for a member`, async () => {
      const { app, calls, session } = await login("member");
      const response = await callRoute(app, session, route);

      expect(response.status).toBe(403);
      expect(calls).toEqual([]);
    });
  }

  test("a platform admin who is only a viewer in the org still reaches them", async () => {
    const { app, calls, session } = await login("viewer", true);
    const response = await callRoute(app, session, {
      body: { baseUrl: "https://example.com/v1" },
      method: "PATCH",
      path: "/v1/providers/provider_1",
    });

    expect(response.status).not.toBe(403);
    expect(calls).toEqual(["updateProvider"]);
  });

  test("an org admin still reaches provider settings", async () => {
    const { app, calls, session } = await login("admin");
    const response = await callRoute(app, session, {
      body: { baseUrl: "https://example.com/v1" },
      method: "PATCH",
      path: "/v1/providers/provider_1",
    });

    expect(response.status).not.toBe(403);
    expect(calls).toEqual(["updateProvider"]);
  });
});
