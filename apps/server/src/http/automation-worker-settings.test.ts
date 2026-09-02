import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../services/agent-service";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createHonoApp } from "./app";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

function createApp() {
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
    taskService: {} as never,
    webDistDir: null,
    workerManager: {} as never,
  });
  return { app, databaseAdapter };
}

describe("automation worker settings routes", () => {
  test("persists the workspace-global five-minute default and requires a platform admin to update it", async () => {
    const { app, databaseAdapter } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const getDefault = await app.fetch(
      new Request("http://localhost:4310/v1/settings/automation-worker", {
        headers: admin.headers(),
      })
    );
    expect(getDefault.status).toBe(200);
    expect(await getDefault.json()).toEqual({ pollIntervalMinutes: 5 });

    const orgId = admin.orgId!;
    const memberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@example.com",
          name: "Member",
          role: "admin",
        }),
        headers: admin.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": admin.csrfToken,
        }),
        method: "POST",
      })
    );
    const { temporaryPassword } = (await memberResponse.json()) as {
      temporaryPassword: string;
    };
    const member = await loginUserSession(
      app,
      "member@example.com",
      temporaryPassword,
      orgId
    );
    const update = (session: typeof admin, minutes: number) =>
      app.fetch(
        new Request("http://localhost:4310/v1/settings/automation-worker", {
          body: JSON.stringify({ pollIntervalMinutes: minutes }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "PUT",
        })
      );
    expect((await update(member, 10)).status).toBe(403);
    expect(await (await update(admin, 10)).json()).toEqual({
      pollIntervalMinutes: 10,
    });
    const stored = await databaseAdapter.getWorkspaceSettings();
    expect(stored?.automationWorkerPollIntervalMs).toBe(10 * 60 * 1000);
    const getSaved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/automation-worker", {
        headers: admin.headers(),
      })
    );
    expect(await getSaved.json()).toEqual({ pollIntervalMinutes: 10 });
    expect((await update(admin, 0)).status).toBe(400);
  });
});
