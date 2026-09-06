import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../services/agent-service";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createHonoApp } from "./app";
import {
  loginPlatformAdminSession,
  loginUserSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

function createHarnessApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const app = createHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    authService,
    automationService: {} as never,
    databaseAdapter,
    mcpService: {} as never,
    orgService: new OrgService(databaseAdapter, authService),
    systemStatus: { getStatus: async () => ({ ok: true }) } as never,
    webDistDir: null,
    workerManager: {} as never,
  });

  return { app, authService, databaseAdapter };
}

describe("coding harness settings routes", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("defaults to Nakama provider passthrough and can switch to harness login", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-coding-harness-route-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const { app, databaseAdapter } = createHarnessApp();

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const getDefault = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        headers: session.headers(),
      })
    );
    expect(getDefault.status).toBe(200);
    const defaultBody = (await getDefault.json()) as {
      providerPassthroughEnabled: boolean;
      loginCommands: Array<{ command: string; name: string }>;
    };
    expect(defaultBody.providerPassthroughEnabled).toBe(true);
    expect(defaultBody.loginCommands.map((item) => item.command)).toEqual([
      "codex login",
      "claude auth login",
      "opencode auth login",
      "pi login",
    ]);

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        body: JSON.stringify({ providerPassthroughEnabled: false }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as {
      providerPassthroughEnabled: boolean;
    };
    expect(saved.providerPassthroughEnabled).toBe(false);

    const getSaved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        headers: session.headers(),
      })
    );
    const savedBody = (await getSaved.json()) as {
      providerPassthroughEnabled: boolean;
    };
    expect(savedBody.providerPassthroughEnabled).toBe(false);
  });

  test("org members can read coding harness settings but cannot write them", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-coding-harness-member-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const { app, databaseAdapter } = createHarnessApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = adminSession.orgId!;

    const memberResp = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@example.com",
          name: "Member",
          role: "member",
        }),
        headers: adminSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": adminSession.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(memberResp.status).toBe(201);
    const memberProvisioned = (await memberResp.json()) as {
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member@example.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const memberGet = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        headers: memberSession.headers(),
      })
    );
    expect(memberGet.status).toBe(200);

    const memberPut = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        body: JSON.stringify({ providerPassthroughEnabled: false }),
        headers: memberSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": memberSession.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(memberPut.status).toBe(403);

    const adminPut = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        body: JSON.stringify({ providerPassthroughEnabled: false }),
        headers: adminSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": adminSession.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(adminPut.status).toBe(200);
    const saved = (await adminPut.json()) as {
      providerPassthroughEnabled: boolean;
    };
    expect(saved.providerPassthroughEnabled).toBe(false);
  });

  test("a platform admin who is only an org member can write the setting", async () => {
    configDir = await mkdtemp(
      join(tmpdir(), "nakama-coding-harness-platform-")
    );
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const { app, authService, databaseAdapter } = createHarnessApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = adminSession.orgId!;

    await loginPlatformAdminSession(app, authService, databaseAdapter);
    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );
    if (!platformUser) {
      throw new Error("platform admin user missing");
    }

    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId,
      role: "member",
      userId: platformUser.id,
    });

    const platformSession = await loginUserSession(
      app,
      "platform@example.com",
      "password123",
      orgId
    );

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        body: JSON.stringify({ providerPassthroughEnabled: false }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as {
      providerPassthroughEnabled: boolean;
    };
    expect(saved.providerPassthroughEnabled).toBe(false);
  });
});
