import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { loadLocalAuthToken } from "@tinyclaw/core";

function createServerOptions() {
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
    authService: new AuthService(),
    databaseAdapter: createInMemoryDatabaseAdapter(),
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

describe("createHonoApp", () => {
  test("accepts opaque bearer auth for internal clients", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "tinyclaw-bearer-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    try {
      const token = await loadLocalAuthToken();
      const app = createHonoApp(createServerOptions());

      const profilesResponse = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(profilesResponse.status).toBe(200);
      await expect(profilesResponse.json()).resolves.toEqual({
        profiles: [{ id: "default" }],
      });

      const whatsappResponse = await app.fetch(
        new Request("http://localhost:4310/v1/settings/whatsapp", {
          headers: { Authorization: `Bearer ${token}` },
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
    const app = createHonoApp(createServerOptions());
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
      const app = createHonoApp(createServerOptions());
      const setupResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "admin@example.com", password: "secret123" }),
        }),
      );
      const setupCookies = extractSetCookies(setupResponse);

      const rotateResponse = await app.fetch(
        new Request("http://localhost:4310/v1/auth/local-token/rotate", {
          method: "POST",
          headers: {
            Cookie: cookieHeaderFromSetCookies(setupCookies),
            "X-CSRF-Token": cookieValue(setupCookies, "tinyclaw_csrf"),
          },
        }),
      );

      expect(rotateResponse.status).toBe(200);
      const payload = (await rotateResponse.json()) as { token: string };
      expect(payload.token).toStartWith("tc_local_");

      const oldToken = await loadLocalAuthToken();
      expect(oldToken).toBe(payload.token);
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
      const app = createHonoApp(createServerOptions());
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
    const app = createHonoApp(createServerOptions());
    const response = await app.fetch(new Request("http://localhost:4310/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      providerConfigured: true,
    });
  });

  test("preserves auth-protected behavior through the Hono shell", async () => {
    const app = createHonoApp(createServerOptions());
    const response = await app.fetch(new Request("http://localhost:4310/v1/sessions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  test("preserves browser session auth through the Hono middleware", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
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
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
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
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/logs?lines=50", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      worker: "whatsapp",
      lines: ["last:50"],
    });
  });

  test("serves model catalog through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/models?source=remote", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: [{ id: "model-remote" }],
    });
  });

  test("serves user context through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/user/context?content=true", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ content: "ctx" });
  });

  test("creates and lists sessions through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );
    const headers = { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) };

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/sessions", {
        method: "POST",
        headers: {
          ...headers,
          "X-CSRF-Token": cookieValue(extractSetCookies(setupResponse), "tinyclaw_csrf"),
        },
        body: JSON.stringify({ channel: "web", profileId: "default" }),
      }),
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({ sessionId: "session_1" });

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/sessions?profileId=default&channel=web", {
        headers,
      }),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [{ id: "default-web" }],
    });
  });

  test("sends non-streaming session messages through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );
    const setCookies = extractSetCookies(setupResponse);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/sessions/session_1/messages", {
        method: "POST",
        headers: {
          Cookie: cookieHeaderFromSetCookies(setCookies),
          "X-CSRF-Token": cookieValue(setCookies, "tinyclaw_csrf"),
        },
        body: JSON.stringify({ message: "hello" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reply: "reply:hello" });
  });

  test("serves profiles through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profiles: [{ id: "default" }] });
  });

  test("serves mcp servers through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/mcp/servers", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ servers: [{ id: "mcp_1" }] });
  });

  test("serves skills through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/skills", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ skills: [{ id: "skill_1" }] });
  });

  test("serves tools through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
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
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ automations: [{ id: "automation_1" }] });
  });

  test("runs automations through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );
    const setCookies = extractSetCookies(setupResponse);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/automations/automation_1/run", {
        method: "POST",
        headers: {
          Cookie: cookieHeaderFromSetCookies(setCookies),
          "X-CSRF-Token": cookieValue(setCookies, "tinyclaw_csrf"),
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: { id: "automation_run_1" } });
  });

  test("serves tasks through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tasks", {
        headers: { Cookie: cookieHeaderFromSetCookies(extractSetCookies(setupResponse)) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks: [{ id: "task_1", status: "pending" }] });
  });

  test("runs tasks through Hono routes", async () => {
    const app = createHonoApp(createServerOptions());
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );
    const setCookies = extractSetCookies(setupResponse);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tasks/task_1/run", {
        method: "POST",
        headers: {
          Cookie: cookieHeaderFromSetCookies(setCookies),
          "X-CSRF-Token": cookieValue(setCookies, "tinyclaw_csrf"),
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: { id: "task_run_1" } });
  });
});
