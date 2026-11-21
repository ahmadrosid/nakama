import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  seedDatabase,
} from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-http-app-test-");

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
  test("compresses chat history when the browser accepts gzip", async () => {
    const options = createServerOptions();
    options.agent.getSessionMessages = async () => ({
      channel: "web",
      contextUsage: null,
      messageMeta: [],
      messages: [{ content: "history ".repeat(12_000), role: "assistant" }],
      model: null,
    });
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const url = "http://localhost:4310/v1/sessions/session_1/messages";
    const headers = session.headers();
    const plain = await app.fetch(new Request(url, { headers }));

    const compressed = await app.fetch(
      new Request(url, {
        headers: { ...headers, "Accept-Encoding": "gzip" },
      })
    );

    expect(plain.headers.get("Content-Encoding")).toBeNull();
    expect(compressed.headers.get("Content-Encoding")).toBe("gzip");
    expect(compressed.headers.get("Vary")).toContain("Accept-Encoding");
    const plainText = await plain.text();
    const compressedBytes = await compressed.bytes();
    expect(compressedBytes.byteLength).toBeLessThan(plainText.length);
    expect(new TextDecoder().decode(Bun.gunzipSync(compressedBytes))).toBe(
      plainText
    );
  });

  test("rejects invalid profile fields before calling the agent service", async () => {
    const options = createServerOptions();
    let calls = 0;
    options.agent.createProfile = async () => {
      calls += 1;
      throw new Error("Unexpected profile creation");
    };

    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    for (const body of [{}, { name: 42 }, { model: true, name: "Agent" }]) {
      const response = await app.fetch(
        new Request("http://localhost:4310/v1/profiles", {
          body: JSON.stringify(body),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        })
      );

      expect(response.status).toBe(400);
    }

    expect(calls).toBe(0);
  });
  test("rejects malformed model requests before calling the agent service", async () => {
    const options = createServerOptions();
    let calls = 0;

    const unexpectedCall = async () => {
      calls += 1;
      throw new Error("Unexpected service call");
    };

    options.agent.transcribeAudio = unexpectedCall;
    options.agent.generateImage = unexpectedCall;
    options.agent.setThinkingSettings = unexpectedCall;
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    for (const [path, method, body] of [
      ["/v1/audio/transcribe", "POST", {}],
      ["/v1/audio/transcribe", "POST", { data: 7, mediaType: "audio/wav" }],
      ["/v1/images/generate", "POST", { prompt: 7 }],
      ["/v1/settings/thinking", "PUT", { enabled: "yes" }],
      ["/v1/settings/thinking", "PUT", { effort: "unknown", enabled: true }],
    ] as const) {
      const response = await app.fetch(
        new Request(`http://localhost:4310${path}`, {
          body: JSON.stringify(body),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

      expect(response.status).toBe(400);
    }

    expect(calls).toBe(0);
  });

  test("rejects malformed MCP requests before calling services", async () => {
    const options = createServerOptions();
    let calls = 0;

    const unexpectedCall = async () => {
      calls += 1;
      throw new Error("Unexpected MCP call");
    };

    options.mcpService.createServer = unexpectedCall;
    options.mcpService.updateServer = unexpectedCall;
    options.mcpService.testServer = unexpectedCall;
    options.agent.assignMcpServer = unexpectedCall;
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    for (const [path, method, body] of [
      ["/v1/mcp/servers", "POST", {}],
      [
        "/v1/mcp/servers",
        "POST",
        {
          config: { url: "https://mcp.example.com" },
          name: 7,
          transport: "http",
        },
      ],
      [
        "/v1/mcp/servers/test",
        "POST",
        { config: { url: "https://mcp.example.com" }, transport: "unknown" },
      ],
      [
        "/v1/mcp/servers/test",
        "POST",
        { config: { url: 7 }, transport: "http" },
      ],
      [
        "/v1/mcp/servers/server",
        "PATCH",
        { config: { args: [7], command: "bun" } },
      ],
      [
        "/v1/mcp/servers/test",
        "POST",
        {
          config: { headers: { TOKEN: 7 }, url: "https://mcp.example.com" },
          transport: "http",
        },
      ],
      [
        "/v1/mcp/servers/test",
        "POST",
        { config: { command: "bun", env: { TOKEN: 7 } }, transport: "stdio" },
      ],
      ["/v1/profiles/default/mcp-servers", "POST", { serverId: 7 }],
    ] as const) {
      const response = await app.fetch(
        new Request(`http://localhost:4310${path}`, {
          body: JSON.stringify(body),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

      expect(response.status).toBe(400);
    }

    expect(calls).toBe(0);
  });

  test("MCP connection tests accept an unnamed server and the command alias", async () => {
    const options = createServerOptions();
    const calls: Parameters<typeof options.mcpService.testServer>[] = [];
    options.mcpService.testServer = async (
      ...input: Parameters<typeof options.mcpService.testServer>
    ) => {
      calls.push(input);

      return { ok: true, toolCount: 0, tools: [] };
    };

    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/mcp/servers/test", {
        body: JSON.stringify({
          config: {
            args: ["server.ts"],
            command: "bun",
            env: { TOKEN: "test" },
          },
          serverId: "existing",
          transport: " COMMAND ",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      [
        "stdio",
        { args: ["server.ts"], command: "bun", env: { TOKEN: "test" } },
        "existing",
      ],
    ]);
  });

  test("omits database-backed settings and notification routes without a database", () => {
    const app = createHonoApp({
      ...createServerOptions(),
      databaseAdapter: null,
    });

    const paths = new Set(app.routes.map((route) => route.path));

    for (const path of [
      "/v1/settings/automation-worker",
      "/v1/settings/coding-harnesses",
      "/v1/notification-destinations",
      "/v1/notify/:destinationId",
      "/v1/platform/data/export",
    ]) {
      expect(paths.has(path)).toBe(false);
    }
  });
  test("a formerly valid stored backend key is rejected while its owner can still sign in", async () => {
    const root = await mkdtemp(join(tmpdir(), "retired-key-auth-"));
    const filename = join(root, "nakama.sqlite");
    const database = await createSqliteDatabase(`file:${filename}`);

    const options = {
      ...createServerOptions(),
      databaseAdapter: database.adapter,
    };

    options.orgService = new OrgService(database.adapter, options.authService);
    const app = createHonoApp(options);

    try {
      await seedDatabase(database.adapter);

      const browser = await setupFreshInstallSession(
        app,
        options.databaseAdapter
      );

      const user =
        await options.databaseAdapter.getUserByEmail("admin@example.com");

      const raw = new Database(filename);
      const token = `nk_live_${"a".repeat(64)}`;

      try {
        raw.exec(
          "CREATE TABLE api_keys (id TEXT, org_id TEXT, name TEXT, environment TEXT, key_prefix TEXT, secret_hash TEXT, created_by_user_id TEXT, created_at TEXT, last_used_at TEXT, expires_at TEXT, revoked_at TEXT)"
        );
        raw
          .query(
            "INSERT INTO api_keys VALUES ('key',?,'Old app','live',?,?,?,'now',NULL,NULL,NULL)"
          )
          .run(
            browser.orgId,
            token.slice(0, 20),
            options.authService.hashToken(token),
            user!.id
          );
        expect(
          (
            await app.fetch(
              new Request("http://localhost/v1/auth/me", {
                headers: { Authorization: `Bearer ${token}` },
              })
            )
          ).status
        ).toBe(401);
        expect(
          (
            await app.fetch(
              new Request("http://localhost/v1/auth/me", {
                body: JSON.stringify({ name: "Changed by retired key" }),
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                method: "PATCH",
              })
            )
          ).status
        ).toBe(401);
        expect(await options.databaseAdapter.getUserById(user!.id)).toEqual(
          user
        );
        expect(
          (
            await app.fetch(
              new Request("http://localhost/v1/auth/me", {
                headers: browser.headers(),
              })
            )
          ).status
        ).toBe(200);
      } finally {
        raw.close(true);
      }
    } finally {
      database.release();
      await rm(root, { force: true, recursive: true });
    }
  });

  test("removed backend keys and routes reject access, and stale app-user inputs create no sessions", async () => {
    const options = createServerOptions();
    let created = 0;
    options.agent.createSession = async () => {
      created += 1;

      return "session_1";
    };

    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    for (const token of [
      `nk_live_${"a".repeat(64)}`,
      `nk_test_${"b".repeat(64)}`,
    ]) {
      expect(
        (
          await app.fetch(
            new Request(
              "http://localhost/v1/sessions?profileId=default&channel=web",
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "X-Nakama-App-User-Id": "alice",
                },
              }
            )
          )
        ).status
      ).toBe(401);
    }

    for (const [method, suffix] of [
      ["GET", ""],
      ["POST", ""],
      ["POST", "/old/rotate"],
      ["DELETE", "/old"],
    ]) {
      expect(
        (
          await app.fetch(
            new Request(
              `http://localhost/v1/orgs/${session.orgId}/api-keys${suffix}`,
              {
                headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
                method,
              }
            )
          )
        ).status
      ).toBe(404);
    }

    for (const appUserId of ["alice", "", null]) {
      expect(
        (
          await app.fetch(
            new Request("http://localhost/v1/sessions", {
              body: JSON.stringify({
                appUserId,
                channel: "web",
                profileId: "default",
              }),
              headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
              method: "POST",
            })
          )
        ).status
      ).toBe(400);
    }

    for (const path of [
      "/v1/sessions?profileId=default&channel=web",
      "/v1/sessions/old/messages",
      "/v1/attachments/old/content",
      "/v1/profiles/default/artifacts",
      "/v1/profiles/default/artifacts/content?filename=old.md",
    ]) {
      expect(
        (
          await app.fetch(
            new Request(`http://localhost${path}`, {
              headers: session.headers({ "X-Nakama-App-User-Id": "" }),
            })
          )
        ).status
      ).toBe(400);
    }

    expect(created).toBe(0);
    expect(
      (
        await app.fetch(
          new Request("http://localhost/v1/sessions", {
            body: JSON.stringify({ channel: "web", profileId: "default" }),
            headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
            method: "POST",
          })
        )
      ).status
    ).toBe(201);
    expect(created).toBe(1);

    const spec = await (
      await app.fetch(new Request("http://localhost/openapi.json"))
    ).text();

    expect(spec.includes("api-keys")).toBe(false);
    expect(spec.includes("appUserId")).toBe(false);
    expect(spec.includes('"api-key"')).toBe(false);
  });
});
