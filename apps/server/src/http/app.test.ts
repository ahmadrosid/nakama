import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadLocalAuthToken, verifyLocalAuthToken } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
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
      assignMcpServer: async (_profileId: string, _body: unknown) => ({
        id: "default",
      }),
      assignSkill: async (_profileId: string, _body: unknown) => ({
        id: "default",
      }),
      assignTool: async (_profileId: string, _body: unknown) => ({
        id: "default",
      }),
      beginSessionTurn: async (_sessionId: string, _orgId: string) => true,
      branchSession: async (_sessionId: string, messageIndex: number) => ({
        sessionId: `branched-${messageIndex}`,
      }),
      clearSession: async (_sessionId: string) => true,
      compactSession: async (_sessionId: string, body: { force: boolean }) => ({
        action: body.force ? "summarized" : "none",
        messagesAfter: 1,
        messagesBefore: 2,
      }),
      configureProvider: async (_body: unknown) => ({ ok: true }),
      createProfile: async (_body: unknown) => ({ id: "profile_1" }),
      createProvider: async (_body: unknown) => ({ providerId: "provider_1" }),
      createSession: async (
        _orgId: string,
        _channel: string,
        _profileId?: string
      ) => "session_1",
      createSkill: async (_body: unknown) => ({ id: "skill_1" }),
      createTool: async (_body: unknown) => ({ id: "tool_1" }),
      deleteKnowledgeBaseDocument: async (
        _profileId: string,
        _documentId: string
      ) => ({ ok: true }),
      deleteProfile: async (_profileId: string) => {},
      deleteProfileAvatar: async (_profileId: string) => {},
      deleteProvider: async (_providerId: string) => ({ ok: true }),
      deleteSkill: async (_skillId: string) => {},
      deleteTool: async (_toolId: string) => {},
      draftAutomation: async (_prompt: string, _channel: string) => ({
        id: "automation_draft",
      }),
      draftTaskPrompt: async (_title: string, _description?: string) =>
        "prompt-1",
      generateImage: async (_body: unknown) => ({
        data: "AA==",
        mediaType: "image/png",
        model: "gpt-image-2",
        size: "1024x1024",
        sizeBytes: 1,
      }),
      getImageGenerationSettings: async () => ({
        imageGeneration: { model: null },
      }),
      getModels: async ({ source }: { source: "catalog" | "remote" }) => ({
        models: [{ id: `model-${source}` }],
      }),
      getProfile: async (_profileId: string) => ({ id: "default" }),
      getProfileAvatar: async (_orgId: string, _profileId: string) => ({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
      }),
      getProfileSoulStack: async (_profileId: string) => ({
        stack: ["SOUL.md"],
      }),
      getProfileSoulStatus: async (
        _profileId: string,
        includeContents: boolean
      ) => ({ content: includeContents ? "soul" : null, hasSoul: true }),
      getSessionMessages: async (_sessionId: string) => ({
        channel: "web",
        messageMeta: [
          { createdAt: new Date().toISOString(), id: "m1", seq: 0 },
        ],
        messages: [{ content: "hi", role: "assistant" }],
      }),
      getSessionTodos: async (_sessionId: string) => [],
      getSkill: async (_skillId: string) => ({ id: "skill_1" }),
      getTaskChatMessages: async (_taskId: string) => ({
        messages: [{ content: "task", role: "assistant" }],
        sessionId: "session_1",
      }),
      getTelegramSettings: async () => ({ enabled: false }),
      getThinkingSettings: async () => ({
        thinking: { effort: "medium", enabled: true },
      }),
      getTool: async (_toolId: string) => ({ id: "tool_1" }),
      getToolSource: async (_toolId: string) => ({ source: "builtin" }),
      getTranscriptionSettings: async () => ({
        transcription: { model: null },
      }),
      getUserContext: async (
        _orgId: string,
        _userId: string,
        includeContent: boolean
      ) => ({
        active: includeContent,
        ...(includeContent ? { content: "ctx" } : {}),
      }),
      getUserTimezone: async () => "Asia/Jakarta",
      getVisionSettings: async () => ({ vision: { model: null } }),
      getWhatsAppSettings: async () => ({ enabled: false }),
      initProfileSoul: async (_profileId: string) => ({ ok: true }),
      initUserContext: async (_orgId: string, _userId: string) => ({
        created: true,
      }),
      listKnowledgeBase: async (_profileId: string) => ({
        documents: [],
        sources: [],
      }),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      listProfileTools: async (_profileId: string) => ({
        tools: [{ id: "tool_1" }],
      }),
      listProviders: async () => ({ providers: [] }),
      listSessions: async (
        _orgId: string,
        profileId: string,
        channel: string
      ) => ({
        sessions: [{ id: `${profileId}-${channel}` }],
      }),
      listSkills: async () => ({ skills: [{ id: "skill_1" }] }),
      listTools: async () => ({ tools: [{ id: "tool_1" }] }),
      providerConfigured: true,
      purgeSession: async (_sessionId: string) => true,
      regenerateTelegramHandshake: async () => ({ enabled: false }),
      regenerateWhatsAppPairingCode: async () => ({ enabled: false }),
      resolveSession: async (_sessionId: string) => ({
        getContextUsage: () => null,
        send: async (input: { message: string }) => `reply:${input.message}`,
      }),
      runAutomation: async (_automationId: string) => ({ skipped: false }),
      runTask: async (_taskId: string) => ({ skipped: false }),
      schedulePostTurnSkillReview: (_sessionId: string) => {},
      scheduleSessionTitleGeneration: (_sessionId: string) => {},
      setImageGenerationSettings: async (_body: unknown) => ({
        imageGeneration: { model: null },
      }),
      setTelegramSettings: async (_body: unknown) => ({ enabled: false }),
      setThinkingSettings: async (_body: unknown) => ({
        thinking: { effort: "medium", enabled: true },
      }),
      setTranscriptionSettings: async (_body: unknown) => ({
        transcription: { model: null },
      }),
      setUserTimezone: async (timezone: string) => timezone,
      setVisionSettings: async (_body: unknown) => ({
        vision: { model: null },
      }),
      setWhatsAppSettings: async (_body: unknown) => ({ enabled: false }),
      syncSkills: async () => ({ synced: 1 }),
      transcribeAudio: async (_body: unknown) => ({ text: "hello" }),
      unassignMcpServer: async (_profileId: string, _serverId: string) => ({
        id: "default",
      }),
      unassignSkill: async (_profileId: string, _skillId: string) => ({
        id: "default",
      }),
      unassignTool: async (_profileId: string, _toolId: string) => ({
        id: "default",
      }),
      updateProfile: async (_profileId: string, _body: unknown) => ({
        id: "default",
      }),
      updateProvider: async (_providerId: string, _body: unknown) => ({
        providerId: "provider_1",
      }),
      uploadKnowledgeBaseDocument: async (
        _profileId: string,
        _doc: unknown
      ) => ({ id: "kb_1" }),
      uploadProfileAvatar: async (_profileId: string, _body: unknown) => ({
        id: "default",
      }),
      writeProfileSoulFile: async (
        _profileId: string,
        _fileKey: string,
        _body: unknown
      ) => {},
      writeUserContext: async (
        _orgId: string,
        _userId: string,
        _body: unknown
      ) => {},
    } as any,
    authService,
    automationService: {
      create: async (_orgId: string, _body: unknown, _profileId?: string) => ({
        id: "automation_1",
      }),
      delete: async (_automationId: string, _orgId: string) => true,
      get: async (_automationId: string, _orgId?: string) => ({
        id: "automation_1",
      }),
      listForOrg: async (_orgId: string, _userId?: string) => ({
        automations: [{ id: "automation_1" }],
        unread: { byAutomationId: {}, totalUnread: 0 },
      }),
      listRuns: async (
        _automationId: string,
        _orgId?: string,
        limit?: number
      ) =>
        limit ? [{ id: "automation_run_1" }] : [{ id: "automation_run_1" }],
      update: async (
        _automationId: string,
        _orgId: string,
        _body: unknown
      ) => ({
        id: "automation_1",
      }),
    } as any,
    databaseAdapter,
    mcpService: {
      connectServer: async (_serverId: string) => ({ id: "mcp_1" }),
      createServer: async (_body: unknown) => ({ id: "mcp_1" }),
      deleteServer: async (_serverId: string) => {},
      getServer: async (_serverId: string) => ({ id: "mcp_1" }),
      listServers: async () => ({ servers: [{ id: "mcp_1" }] }),
      syncServer: async (_serverId: string) => ({ id: "mcp_1" }),
      testServer: async (
        _transport: unknown,
        _config: unknown,
        _serverId: unknown
      ) => ({ ok: true }),
      updateServer: async (_serverId: string, _body: unknown) => ({
        id: "mcp_1",
      }),
    } as any,
    orgService: new OrgService(databaseAdapter, authService),
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    taskService: {
      create: async (_orgId: string, _body: unknown, _profileId?: string) => ({
        id: "task_1",
        status: "pending",
      }),
      delete: async (_taskId: string, _orgId: string) => true,
      get: async (_taskId: string, _orgId?: string) => ({
        id: "task_1",
        status: "pending",
      }),
      listForOrg: async (_orgId: string) => [
        { id: "task_1", status: "pending" },
      ],
      listRuns: async (_taskId: string, _orgId?: string, limit?: number) =>
        limit ? [{ id: "task_run_1" }] : [{ id: "task_run_1" }],
      update: async (
        _taskId: string,
        _orgId: string,
        body: any,
        _opts?: unknown
      ) => ({
        id: "task_1",
        status: body.status ?? "pending",
      }),
    } as any,
    webDistDir: null,
    workerManager: {
      clearWorkerLogs: async () => {},
      getWorkerLogs: async (_name: string, lines: number) => ({
        lines: [`last:${lines}`],
        worker: "whatsapp",
      }),
      isValidWorker: () => true,
      restartWorker: async () => {},
      startWorker: async () => {},
      stopWorker: async () => {},
    } as any,
  };
}

describe("createHonoApp", () => {
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

  test("serves task chat capability probe without auth", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/tasks/__capability_probe__/messages"
      )
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Task not found.",
    });
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

  const smokeRoutes = [
    {
      expected: { lines: ["last:50"], worker: "whatsapp" },
      name: "serves worker logs through Hono routes",
      path: "/v1/workers/whatsapp/logs?lines=50",
    },
    {
      expected: { models: [{ id: "model-remote" }] },
      name: "serves model catalog through Hono routes",
      path: "/v1/models?source=remote",
    },
    {
      expected: { active: true, content: "ctx" },
      name: "serves user context through Hono routes",
      path: "/v1/user/context?content=true",
    },
    {
      csrf: true,
      expected: { reply: "reply:hello" },
      method: "POST" as const,
      name: "sends non-streaming session messages through Hono routes",
      path: "/v1/sessions/session_1/messages",
      requestBody: { message: "hello" },
    },
    {
      expected: { profiles: [{ id: "default" }] },
      name: "serves profiles through Hono routes",
      path: "/v1/profiles",
    },
    {
      expected: { servers: [{ id: "mcp_1" }] },
      name: "serves mcp servers through Hono routes",
      path: "/v1/mcp/servers",
    },
    {
      expected: { skills: [{ id: "skill_1" }] },
      name: "serves skills through Hono routes",
      path: "/v1/skills",
    },
    {
      expected: { tools: [{ id: "tool_1" }] },
      name: "serves tools through Hono routes",
      path: "/v1/tools",
    },
    {
      expected: {
        automations: [{ id: "automation_1" }],
        unread: { byAutomationId: {}, totalUnread: 0 },
      },
      name: "serves automations through Hono routes",
      path: "/v1/automations",
    },
    {
      csrf: true,
      expected: { run: { id: "automation_run_1" } },
      method: "POST" as const,
      name: "runs automations through Hono routes",
      path: "/v1/automations/automation_1/run",
    },
    {
      expected: { tasks: [{ id: "task_1", status: "pending" }] },
      name: "serves tasks through Hono routes",
      path: "/v1/tasks",
    },
    {
      csrf: true,
      expected: { run: { id: "task_run_1" } },
      method: "POST" as const,
      name: "runs tasks through Hono routes",
      path: "/v1/tasks/task_1/run",
    },
  ] as const;

  for (const tc of smokeRoutes) {
    test(tc.name, async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await setupFreshInstallSession(
        app,
        options.databaseAdapter
      );

      const method = "method" in tc ? tc.method : "GET";
      const headers =
        "csrf" in tc && tc.csrf
          ? session.headers({ "X-CSRF-Token": session.csrfToken })
          : session.headers();
      const init: RequestInit = { headers, method };
      if ("requestBody" in tc) {
        init.body = JSON.stringify(tc.requestBody);
      }

      const response = await app.fetch(
        new Request(`http://localhost:4310${tc.path}`, init)
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(tc.expected);
    });
  }

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
