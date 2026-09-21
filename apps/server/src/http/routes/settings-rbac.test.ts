import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@nakama/core";
import {
  loadWhatsAppConfigFile,
  syncWhatsAppOwnerPairing,
} from "@nakama/core/whatsapp-config";
import {
  getWhatsAppWorkerStatus,
  writeWhatsAppQrCode,
} from "@nakama/core/whatsapp-worker";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import type { ServerOptions } from "../context";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-settings-rbac-test-");

test("WhatsApp HTTP settings, profiles, QR codes and reconnect are isolated by organization", async () => {
  const db = createInMemoryDatabaseAdapter();
  const service = new AgentService(null, null, db);
  const workerCalls: string[] = [];
  const { app, authService } = createMinimalHonoApp({
    databaseAdapter: db,
    agent: service,
    workerManager: {
      getWorkerStatus: async () => ({ managed: true, status: "online" }),
      saveChannelConfig: async (
        _name: string,
        owner: { orgId: string; profileId: string },
        save: () => Promise<unknown>
      ) => {
        workerCalls.push("stop:" + owner.orgId + ":" + owner.profileId);
        const result = await save();
        workerCalls.push("start:" + owner.orgId + ":" + owner.profileId);
        return result;
      },
      stopWorker: async (
        _name: string,
        owner: { orgId: string; profileId: string }
      ) => {
        workerCalls.push("stop:" + owner.orgId + ":" + owner.profileId);
      },
      startWorker: async (
        _name: string,
        owner: { orgId: string; profileId: string }
      ) => {
        workerCalls.push("start:" + owner.orgId + ":" + owner.profileId);
      },
    },
  });
  for (const id of ["a", "b"]) {
    await seedOrgAdmin(db, {
      authService,
      orgId: "wa_" + id,
      userId: "wa_user_" + id,
      email: id + "@wa.test",
      password: "password123",
      profileId: "profile_wa_" + id,
    });
  }
  const a = await loginUserSession(app, "a@wa.test", "password123", "wa_a");
  const b = await loginUserSession(app, "b@wa.test", "password123", "wa_b");
  for (const [id, session] of [
    ["a", a],
    ["b", b],
  ] as const) {
    const saved = await callRoute(app, session, {
      method: "PUT",
      path: `/v1/settings/whatsapp?profileId=profile_wa_${id}`,
      body: {
        profileId: "profile_wa_" + id,
        allowedPhones: id === "a" ? "628111111111" : "628222222222",
      },
    });
    expect(saved.status).toBe(200);
  }
  const foreignProfile = await callRoute(app, a, {
    method: "PUT",
    path: "/v1/settings/whatsapp?profileId=profile_wa_b",
    body: { profileId: "profile_wa_b" },
  });
  expect(foreignProfile.status).toBe(404);
  const foreignOrg = await app.fetch(
    new Request("http://localhost:4310/v1/settings/whatsapp", {
      headers: a.headers({}, "wa_b"),
    })
  );
  expect(foreignOrg.status).toBe(404);
  await writeWhatsAppQrCode("qr-a", {
    orgId: "wa_a",
    profileId: "profile_wa_a",
  });
  await writeWhatsAppQrCode("qr-b", {
    orgId: "wa_b",
    profileId: "profile_wa_b",
  });
  expect(
    (
      await getWhatsAppWorkerStatus({
        orgId: "wa_a",
        profileId: "profile_wa_a",
      })
    ).qrCode
  ).toBe("qr-a");
  expect(
    (
      await getWhatsAppWorkerStatus({
        orgId: "wa_b",
        profileId: "profile_wa_b",
      })
    ).qrCode
  ).toBe("qr-b");
  await syncWhatsAppOwnerPairing(
    { ownerJid: "628222222222@s.whatsapp.net" },
    { orgId: "wa_b", profileId: "profile_wa_b" }
  );
  const reconnect = await callRoute(app, a, {
    method: "POST",
    path: "/v1/settings/whatsapp/reconnect?profileId=profile_wa_a",
  });
  expect(reconnect.status).toBe(200);
  expect(workerCalls).toEqual([
    "stop:wa_a:profile_wa_a",
    "start:wa_a:profile_wa_a",
  ]);
  expect(
    (
      await getWhatsAppWorkerStatus({
        orgId: "wa_b",
        profileId: "profile_wa_b",
      })
    ).qrCode
  ).toBe("qr-b");
  expect(
    (await loadWhatsAppConfigFile({ orgId: "wa_b", profileId: "profile_wa_b" }))
      ?.pairedJid
  ).toBe("628222222222@s.whatsapp.net");
  expect(
    (await loadWhatsAppConfigFile({ orgId: "wa_a", profileId: "profile_wa_a" }))
      ?.profileId
  ).toBe("profile_wa_a");
  const readB = await callRoute(app, b, {
    method: "GET",
    path: "/v1/settings/whatsapp?profileId=profile_wa_b",
  });
  expect(await readB.json()).toMatchObject({
    profileId: "profile_wa_b",
    allowedPhones: ["628222222222"],
  });
});

const ORG_ID = "org_settings_rbac";
const PASSWORD = "password123";

// These settings are install-wide: changing them affects every organization.
const INSTALL_WRITES: { body?: unknown; method: string; path: string }[] = [
  { method: "POST", path: "/v1/xai-oauth/device/start" },
  {
    method: "POST",
    path: "/v1/xai-oauth/device/complete",
    body: { sessionId: "invalid" },
  },
  { method: "POST", path: "/v1/chatgpt-oauth/device/start" },
  {
    method: "POST",
    path: "/v1/chatgpt-oauth/device/complete",
    body: { sessionId: "invalid" },
  },
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
  {
    body: { timezone: "Asia/Jakarta" },
    method: "PUT",
    path: "/v1/settings/timezone",
  },
  {
    body: { effort: "medium", enabled: true },
    method: "PUT",
    path: "/v1/settings/thinking",
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
  { body: { apiKey: "c" }, method: "PUT", path: "/v1/settings/composio" },
  {
    body: { apiKey: "exa-key", provider: "exa" },
    method: "PUT",
    path: "/v1/settings/web-search",
  },
  {
    body: { smtpHost: "smtp.example.com" },
    method: "PUT",
    path: "/v1/settings/email",
  },
  { method: "POST", path: "/v1/settings/email/test" },
  { method: "POST", path: "/v1/settings/agent-browser/install" },
  {
    body: { providerPassthroughEnabled: false },
    method: "PUT",
    path: "/v1/settings/coding-harnesses",
  },
  {
    body: { dsn: "https://publickey@errors.example.com/42" },
    method: "PUT",
    path: "/v1/settings/error-tracking",
  },
  { method: "POST", path: "/v1/settings/error-tracking/test" },
];

for (const role of ["member", "viewer"] as const) {
  for (const [method, path] of [
    ["GET", "/v1/settings/telegram?profileId=default"],
    ["GET", "/v1/settings/discord?profileId=default"],
    ["GET", "/v1/settings/whatsapp?profileId=default"],
    ["GET", "/v1/system/status?profileId=default"],
    ["PUT", "/v1/settings/whatsapp"],
    ["POST", "/v1/settings/whatsapp/pairing-code"],
    ["POST", "/v1/settings/whatsapp/reconnect"],
    ["POST", "/v1/workers/whatsapp/start"],
    ["GET", "/v1/workers/whatsapp/logs"],
  ]) {
    test(`WhatsApp ${method} ${path} rejects ${role}`, async () => {
      const { app, calls, session } = await login(role);
      expect((await callRoute(app, session, { method, path })).status).toBe(
        403
      );
      expect(calls).toEqual([]);
    });
  }
}

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
      getProfile: async () => ({ profile: { id: "default" } }),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      sendErrorTrackingTest: record("sendErrorTrackingTest"),
      setComposioSettings: record("setComposioSettings"),
      setDiscordSettings: record("setDiscordSettings"),
      setErrorTrackingSettings: record("setErrorTrackingSettings"),
      setImageGenerationSettings: record("setImageGenerationSettings"),
      setTelegramSettings: record("setTelegramSettings"),
      setThinkingSettings: record("setThinkingSettings"),
      setTranscriptionSettings: record("setTranscriptionSettings"),
      setUserTimezone: record("setUserTimezone"),
      setVisionSettings: record("setVisionSettings"),
      setWebSearchSettings: record("setWebSearchSettings"),
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

describe("install-wide settings writes require a platform admin", () => {
  for (const route of INSTALL_WRITES) {
    for (const role of ["viewer", "member", "admin"] as const) {
      test(`${route.method} ${route.path} -> 403 for ${role}`, async () => {
        const { app, calls, session } = await login(role);
        const response = await callRoute(app, session, route);

        expect(response.status).toBe(403);
        // The guard must reject before the global config is touched.
        expect(calls).toEqual([]);
      });
    }
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

  test("an org admin can still change org-scoped Telegram settings", async () => {
    const { app, calls, session } = await login("admin");
    const response = await callRoute(app, session, {
      body: { botToken: "telegram-token" },
      method: "PUT",
      path: "/v1/settings/telegram?profileId=default",
    });

    expect(response.status).not.toBe(403);
    expect(calls).toEqual(["setTelegramSettings"]);
  });
});

test("a platform admin completes Grok device sign-in through authenticated HTTP routes", async () => {
  const { app, session } = await login("admin", true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/device/code")) {
      return Response.json({
        device_code: "private-device",
        user_code: "CODE",
        verification_uri: "https://accounts.x.ai/oauth2/device",
        interval: 1,
        expires_in: 60,
      });
    }
    if (url.endsWith("/oauth2/token")) {
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 900,
      });
    }
    if (url.endsWith("/models-v2")) {
      return Response.json({ models: [{ id: "grok-4.6" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const start = await callRoute(app, session, {
      method: "POST",
      path: "/v1/xai-oauth/device/start",
    });
    expect(start.status).toBe(200);
    const body = (await start.json()) as { sessionId: string };
    const result = await callRoute(app, session, {
      method: "POST",
      path: "/v1/xai-oauth/device/complete",
      body,
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      xaiOAuth: { accessToken: "access", refreshToken: "refresh" },
      models: [{ id: "grok-4.6" }],
    });
    const replay = await callRoute(app, session, {
      method: "POST",
      path: "/v1/xai-oauth/device/complete",
      body,
    });
    expect(replay.status).toBe(400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("channel settings require an owner and keep sibling agents separate", async () => {
  const db = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({
    databaseAdapter: db,
    agent: new AgentService(null, null, db),
  });
  const seeded = await seedOrgAdmin(db, {
    authService,
    orgId: "org_siblings",
    profileId: "agent_a",
  });
  const first = (await db.listProfilesForOrg(seeded.orgId))[0]!;
  await db.upsertProfile({
    ...first,
    id: "agent_b",
    name: "Agent B",
    isDefault: false,
  });
  const session = await loginUserSession(
    app,
    seeded.email,
    seeded.password,
    seeded.orgId
  );
  for (const platform of ["telegram", "discord", "whatsapp"]) {
    expect(
      (
        await callRoute(app, session, {
          method: "GET",
          path: `/v1/settings/${platform}`,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await callRoute(app, session, {
          method: "GET",
          path: `/v1/settings/${platform}?profileId=missing`,
        })
      ).status
    ).toBe(404);
  }
  for (const [profileId, phone] of [
    ["agent_a", "628111111111"],
    ["agent_b", "628222222222"],
  ]) {
    expect(
      (
        await callRoute(app, session, {
          method: "PUT",
          path: `/v1/settings/whatsapp?profileId=${profileId}`,
          body: { profileId: "agent_b", allowedPhones: phone },
        })
      ).status
    ).toBe(200);
  }
  const a = await callRoute(app, session, {
    method: "GET",
    path: "/v1/settings/whatsapp?profileId=agent_a",
  });
  const b = await callRoute(app, session, {
    method: "GET",
    path: "/v1/settings/whatsapp?profileId=agent_b",
  });
  expect(await a.json()).toMatchObject({
    profileId: "agent_a",
    allowedPhones: ["628111111111"],
  });
  expect(await b.json()).toMatchObject({
    profileId: "agent_b",
    allowedPhones: ["628222222222"],
  });
});
