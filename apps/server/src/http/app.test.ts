import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OrgRole } from "@tinyclaw/core";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { loadLocalAuthToken, verifyLocalAuthToken } from "@tinyclaw/core";
import {
  buildSetupAuthBody,
  seedLocalClientUser,
  seedOrgForUser,
  TEST_ORG_ID,
  withOrgId,
} from "./test-org-helpers";

function createServerOptions() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    agent: {
      providerConfigured: true,
      getUserContext: async (includeContent: boolean) => ({ content: includeContent ? "ctx" : null }),
      writeUserContext: async (_body: unknown) => {},
      initUserContext: async () => ({ content: "init" }),
      createSession: async (_channel: string, _profileId?: string) => "session_1",
      listSessions: async (profileId: string, channel: string) => ({ sessions: [{ id: `${profileId}-${channel}` }] }),
      clearSession: async (_sessionId: string) => true,
      purgeSession: async (_sessionId: string) => true,
      compactSession: async (_sessionId: string, body: { force: boolean }) => ({ action: body.force ? "summarized" : "none", messagesBefore: 2, messagesAfter: 1 }),
      getSessionMessages: async (_sessionId: string) => ({ messages: [{ role: "assistant", content: "hi" }], messageMeta: [{ id: "m1", seq: 0, createdAt: new Date().toISOString() }] }),
      getSessionTodos: async (_sessionId: string) => [],
      branchSession: async (_sessionId: string, messageIndex: number) => ({ sessionId: `branched-${messageIndex}` }),
      resolveSession: async (_sessionId: string) => ({ send: async (input: { message: string }) => `reply:${input.message}` }),
      scheduleSessionTitleGeneration: (_sessionId: string) => {},
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      createProfile: async (_body: unknown) => ({ id: "profile_1" }),
      getProfileSoulStatus: async (_profileId: string, includeContents: boolean) => ({ hasSoul: true, content: includeContents ? "soul" : null }),
      getProfileSoulStack: async (_profileId: string) => ({ stack: ["SOUL.md"] }),
      initProfileSoul: async (_profileId: string) => ({ ok: true }),
      writeProfileSoulFile: async (_profileId: string, _fileKey: string, _body: unknown) => {},
      listKnowledgeBase: async (_profileId: string) => ({ documents: [] }),
      uploadKnowledgeBaseDocument: async (_profileId: string, _doc: unknown) => ({ id: "kb_1" }),
      deleteKnowledgeBaseDocument: async (_profileId: string, _documentId: string) => ({ ok: true }),
      getProfileAvatar: async (_profileId: string) => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }),
      uploadProfileAvatar: async (_profileId: string, _body: unknown) => ({ id: "default" }),
      deleteProfileAvatar: async (_profileId: string) => {},
      getProfile: async (_profileId: string) => ({ id: "default" }),
      updateProfile: async (_profileId: string, _body: unknown) => ({ id: "default" }),
      deleteProfile: async (_profileId: string) => {},
      listSkills: async () => ({ skills: [{ id: "skill_1" }] }),
      createSkill: async (_body: unknown) => ({ id: "skill_1" }),
      syncSkills: async () => ({ synced: 1 }),
      getSkill: async (_skillId: string) => ({ id: "skill_1" }),
      deleteSkill: async (_skillId: string) => {},
      assignSkill: async (_profileId: string, _body: unknown) => ({ id: "default" }),
      unassignSkill: async (_profileId: string, _skillId: string) => ({ id: "default" }),
      listTools: async () => ({ tools: [{ id: "tool_1" }] }),
      createTool: async (_body: unknown) => ({ id: "tool_1" }),
      getToolSource: async (_toolId: string) => ({ source: "builtin" }),
      getTool: async (_toolId: string) => ({ id: "tool_1" }),
      deleteTool: async (_toolId: string) => {},
      listProfileTools: async (_profileId: string) => ({ tools: [{ id: "tool_1" }] }),
      assignTool: async (_profileId: string, _body: unknown) => ({ id: "default" }),
      unassignTool: async (_profileId: string, _toolId: string) => ({ id: "default" }),
      assignMcpServer: async (_profileId: string, _body: unknown) => ({ id: "default" }),
      unassignMcpServer: async (_profileId: string, _serverId: string) => ({ id: "default" }),
      draftAutomation: async (_prompt: string, _channel: string) => ({ id: "automation_draft" }),
      runAutomation: async (_automationId: string) => ({ skipped: false }),
      draftTaskPrompt: async (_title: string, _description?: string) => "prompt-1",
      runTask: async (_taskId: string) => ({ skipped: false }),
      getTaskChatMessages: async (_taskId: string) => ({ sessionId: "session_1", messages: [{ role: "assistant", content: "task" }] }),
      getModels: async ({ source }: { source: "catalog" | "remote" }) => ({
        models: [{ id: `model-${source}` }],
      }),
      listProviders: async () => ({ providers: [] }),
      createProvider: async (_body: unknown) => ({ providerId: "provider_1" }),
      updateProvider: async (_providerId: string, _body: unknown) => ({ providerId: "provider_1" }),
      deleteProvider: async (_providerId: string) => ({ ok: true }),
      configureProvider: async (_body: unknown) => ({ ok: true }),
      getUserTimezone: async () => "Asia/Jakarta",
      setUserTimezone: async (timezone: string) => timezone,
      getThinkingSettings: async () => ({ thinking: { enabled: true, effort: "medium" } }),
      setThinkingSettings: async (_body: unknown) => ({ thinking: { enabled: true, effort: "medium" } }),
      getVisionSettings: async () => ({ vision: { model: null } }),
      setVisionSettings: async (_body: unknown) => ({ vision: { model: null } }),
      getTelegramSettings: async () => ({ enabled: false }),
      setTelegramSettings: async (_body: unknown) => ({ enabled: false }),
      regenerateTelegramHandshake: async () => ({ enabled: false }),
      getWhatsAppSettings: async () => ({ enabled: false }),
      setWhatsAppSettings: async (_body: unknown) => ({ enabled: false }),
      regenerateWhatsAppPairingCode: async () => ({ enabled: false }),
    } as any,
    automationService: {
      list: async () => [{ id: "automation_1" }],
      create: async (_body: unknown, _profileId?: string) => ({ id: "automation_1" }),
      get: async (_automationId: string) => ({ id: "automation_1" }),
      update: async (_automationId: string, _body: unknown) => ({ id: "automation_1" }),
      delete: async (_automationId: string) => true,
      listRuns: async (_automationId: string, limit?: number) =>
        limit ? [{ id: "automation_run_1" }] : [{ id: "automation_run_1" }],
    } as any,
    taskService: {
      list: async () => [{ id: "task_1", status: "pending" }],
      create: async (_body: unknown, _profileId?: string) => ({ id: "task_1", status: "pending" }),
      get: async (_taskId: string) => ({ id: "task_1", status: "pending" }),
      update: async (_taskId: string, body: any, _opts?: unknown) => ({ id: "task_1", status: body.status ?? "pending" }),
      delete: async (_taskId: string) => true,
      listRuns: async (_taskId: string, limit?: number) =>
        limit ? [{ id: "task_run_1" }] : [{ id: "task_run_1" }],
    } as any,
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    workerManager: {
      isValidWorker: () => true,
      startWorker: async () => {},
      stopWorker: async () => {},
      restartWorker: async () => {},
      getWorkerLogs: async (_name: string, lines: number) => ({ worker: "whatsapp", lines: [`last:${lines}`] }),
      clearWorkerLogs: async () => {},
    } as any,
    mcpService: {
      listServers: async () => ({ servers: [{ id: "mcp_1" }] }),
      createServer: async (_body: unknown) => ({ id: "mcp_1" }),
      testServer: async (_transport: unknown, _config: unknown, _serverId: unknown) => ({ ok: true }),
      connectServer: async (_serverId: string) => ({ id: "mcp_1" }),
      syncServer: async (_serverId: string) => ({ id: "mcp_1" }),
      getServer: async (_serverId: string) => ({ id: "mcp_1" }),
      updateServer: async (_serverId: string, _body: unknown) => ({ id: "mcp_1" }),
      deleteServer: async (_serverId: string) => {},
    } as any,
    authService,
    orgService: new OrgService(databaseAdapter, authService),
    databaseAdapter,
    webDistDir: null,
  };
}

function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
}

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Missing cookie: ${name}`);
  }

  return cookie.split(";")[0]!.split("=", 2)[1]!;
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return [
    `tinyclaw_session=${cookieValue(setCookies, "tinyclaw_session")}`,
    `tinyclaw_csrf=${cookieValue(setCookies, "tinyclaw_csrf")}`,
  ].join("; ");
}

async function authSession(
  options: ReturnType<typeof createServerOptions>,
  app: ReturnType<typeof createHonoApp>,
  email = "admin@example.com",
  role: OrgRole = "admin",
) {
  const setupResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify(buildSetupAuthBody(email)),
    }),
  );
  const setupBody = (await setupResponse.json()) as { activeOrgId: string };
  const setCookies = extractSetCookies(setupResponse);
  const orgId = setupBody.activeOrgId;

  if (role !== "admin") {
    const user = await options.databaseAdapter.getUserByEmail(email);
    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    await options.databaseAdapter.upsertOrgMember({
      orgId,
      userId: user.id,
      role,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    setupResponse,
    setCookies,
    orgId,
    headers(extra: Record<string, string> = {}) {
      return withOrgId({ Cookie: cookieHeaderFromSetCookies(setCookies), ...extra }, orgId);
    },
  };
}

describe("createHonoApp", () => {
  test("accepts opaque bearer auth for internal clients", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "tinyclaw-bearer-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

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
          headers: { Authorization: `Bearer ${token}`, "X-Org-Id": TEST_ORG_ID },
        }),
      );

      expect(profilesResponse.status).toBe(200);
      await expect(profilesResponse.json()).resolves.toEqual({
        profiles: [{ id: "default" }],
      });

      const whatsappResponse = await app.fetch(
        new Request("http://localhost:4310/v1/settings/whatsapp", {
          headers: { Authorization: `Bearer ${token}`, "X-Org-Id": TEST_ORG_ID },
        }),
      );

      expect(whatsappResponse.status).toBe(200);
      await expect(whatsappResponse.json()).resolves.toEqual({ enabled: false });
    } finally {
      delete process.env.TINYCLAW_CONFIG_DIR;
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("rejects invalid bearer auth with 401 instead of 500", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: { Authorization: "Bearer invalid_token" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  test("rotates the local auth token from a browser session", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "tinyclaw-rotate-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    try {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildSetupAuthBody("admin@example.com", { admin: { password: "secret123" } })),
        }),
      );
      const setupCookies = extractSetCookies(setupResponse);
      const orgId = await seedOrgForUser(options.databaseAdapter, "admin@example.com");

      const rotateResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/local-token/rotate", {
          method: "POST",
          headers: withOrgId(
            {
              Cookie: cookieHeaderFromSetCookies(setupCookies),
              "X-CSRF-Token": cookieValue(setupCookies, "tinyclaw_csrf"),
            },
            orgId,
          ),
        }),
      );

      expect(rotateResponse.status).toBe(200);
      const rotatePayload = (await rotateResponse.json()) as { token: string };
      expect(rotatePayload.token).toStartWith("tc_local_");

      const oldToken = await loadLocalAuthToken();
      expect(oldToken).toBe(rotatePayload.token);
    } finally {
      delete process.env.TINYCLAW_CONFIG_DIR;
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("rejects local auth token rotation from bearer auth", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "tinyclaw-rotate-auth-bearer-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    try {
      const token = await loadLocalAuthToken();
      const options = createServerOptions();
      await seedLocalClientUser(options.databaseAdapter);
      const app = createHonoApp(options);
      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/local-token/rotate", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Sign in through the dashboard to rotate the local auth token.",
      });
    } finally {
      delete process.env.TINYCLAW_CONFIG_DIR;
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("serves health through the Hono fetch boundary", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(new Request("http://localhost:4310/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      providerConfigured: true,
    });
  });

  test("preserves auth-protected behavior through the Hono shell", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const response = await app.fetch(new Request("http://localhost:4310/v1/sessions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  test("preserves browser session auth through the Hono middleware", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );

    expect(setupResponse.status).toBe(201);
    const setCookies = extractSetCookies(setupResponse);
    const meResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: { Cookie: cookieHeaderFromSetCookies(setCookies) },
      }),
    );

    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toEqual({ email: "admin@example.com" });
  });

  test("preserves CSRF rejection through the Hono middleware", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );

    const setCookies = extractSetCookies(setupResponse);
    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/start", {
        method: "POST",
        headers: { Cookie: cookieHeaderFromSetCookies(setCookies) },
      }),
    );

    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({
      error: "CSRF validation failed.",
    });
  });

  test("serves worker logs through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/logs?lines=50", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      worker: "whatsapp",
      lines: ["last:50"],
    });
  });

  test("serves model catalog through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/models?source=remote", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: [{ id: "model-remote" }],
    });
  });

  test("serves user context through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/user/context?content=true", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ content: "ctx" });
  });

  test("creates and lists sessions through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/sessions", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({ channel: "web", profileId: "default" }),
      }),
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({ sessionId: "session_1" });

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/sessions?profileId=default&channel=web", {
        headers: session.headers(),
      }),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [{ id: "default-web" }],
    });
  });

  test("sends non-streaming session messages through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/sessions/session_1/messages", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({ message: "hello" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reply: "reply:hello" });
  });

  test("serves profiles through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profiles: [{ id: "default" }] });
  });

  test("serves mcp servers through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/mcp/servers", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ servers: [{ id: "mcp_1" }] });
  });

  test("serves skills through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/skills", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ skills: [{ id: "skill_1" }] });
  });

  test("serves tools through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tools: [{ id: "tool_1" }] });
  });

  test("serves automations through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ automations: [{ id: "automation_1" }] });
  });

  test("runs automations through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/automations/automation_1/run", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: { id: "automation_run_1" } });
  });

  test("serves tasks through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tasks", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks: [{ id: "task_1", status: "pending" }] });
  });

  test("runs tasks through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await authSession(options, app);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tasks/task_1/run", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: { id: "task_run_1" } });
  });

  describe("org context middleware", () => {
    test("setup stores active org on the session", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          method: "POST",
          body: JSON.stringify(buildSetupAuthBody()),
        }),
      );

      expect(setupResponse.status).toBe(201);
      const setupBody = (await setupResponse.json()) as { activeOrgId: string; orgId: string };
      expect(setupBody.activeOrgId).toStartWith("org_");
      expect(setupBody.orgId).toBe(setupBody.activeOrgId);

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
        }),
      );

      expect(response.status).toBe(200);
    });

    test("returns 400 when org context is missing on protected routes", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          method: "POST",
          body: JSON.stringify(buildSetupAuthBody()),
        }),
      );

      const loginResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
        }),
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(loginResponse)) },
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Organization context required",
      });
    });

    test("returns 404 when org membership is missing", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await authSession(options, app);

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: withOrgId(session.headers(), "org_other"),
        }),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Not found" });
    });

    test("allows authenticated requests with valid org context", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await authSession(options, app);

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: session.headers(),
        }),
      );

      expect(response.status).toBe(200);
    });

    test("skips org context for auth routes", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          method: "POST",
          body: JSON.stringify(buildSetupAuthBody()),
        }),
      );

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/me", {
          headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
        }),
      );

      expect(response.status).toBe(200);
    });

    test("returns 403 when viewers mutate protected routes", async () => {
      const options = createServerOptions();
      const app = createHonoApp(options);
      const session = await authSession(options, app, "viewer@example.com", "viewer");

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/workers/whatsapp/start", {
          method: "POST",
          headers: session.headers({
            "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
          }),
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    });
  });
});
