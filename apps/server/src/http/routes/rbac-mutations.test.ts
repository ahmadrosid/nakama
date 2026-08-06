import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@nakama/core";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { loginUserSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-rbac-mutations-test-");

const ORG_ID = "org_test";
const PASSWORD = "password123";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const calls: string[] = [];
  const record = (name: string) =>
    async (..._args: unknown[]) => {
      calls.push(name);
      return { id: "x", name: "x", prompt: "x" } as any;
    };

  const app = createHonoApp({
    agent: {
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      draftAutomation: record("agent.draftAutomation"),
      runAutomation: async () => {
        calls.push("agent.runAutomation");
        return { skipped: false };
      },
      draftTaskPrompt: record("agent.draftTaskPrompt"),
      runTask: async () => {
        calls.push("agent.runTask");
        return { skipped: false };
      },
    } as any,
    automationService: {
      create: record("automationService.create"),
      update: record("automationService.update"),
      delete: record("automationService.delete"),
      get: async () => ({ id: "a", name: "a", prompt: "x" }),
      deleteRun: record("automationService.deleteRun"),
      listRuns: async () => [{ id: "r", status: "ok" }],
    } as any,
    taskService: {
      create: record("taskService.create"),
      update: record("taskService.update"),
      delete: record("taskService.delete"),
      get: async () => ({ id: "t", status: "todo" }),
      listRuns: async () => [{ id: "r", status: "ok" }],
    } as any,
    systemStatus: { getStatus: async () => ({ ok: true }) } as any,
    workerManager: {} as any,
    mcpService: {} as any,
    authService,
    orgService: new OrgService(databaseAdapter, authService),
    databaseAdapter,
    webDistDir: null,
  });

  return { app, databaseAdapter, authService, calls };
}

async function seedUser(
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>,
  authService: AuthService,
  email: string,
  role: OrgRole,
) {
  const now = new Date().toISOString();
  const userId = `user_${role}`;
  await databaseAdapter.createUser({
    id: userId,
    email,
    passwordHash: await authService.hashPassword(PASSWORD),
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrganization({
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({ orgId: ORG_ID, userId, role, createdAt: now });
}

// State-changing routes a viewer must not be able to reach.
const MUTATING_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "POST", path: "/v1/automations/draft", body: { prompt: "x", channel: "web" } },
  { method: "POST", path: "/v1/automations", body: { name: "x", prompt: "x" } },
  { method: "PUT", path: "/v1/automations/a1", body: { name: "x" } },
  { method: "DELETE", path: "/v1/automations/a1" },
  { method: "POST", path: "/v1/automations/a1/run" },
  { method: "DELETE", path: "/v1/automations/a1/runs/r1" },
  { method: "POST", path: "/v1/tasks/draft-prompt", body: { title: "x", description: "x" } },
  { method: "POST", path: "/v1/tasks", body: { title: "x", prompt: "x" } },
  { method: "PUT", path: "/v1/tasks/t1", body: { title: "x" } },
  { method: "DELETE", path: "/v1/tasks/t1" },
  { method: "POST", path: "/v1/tasks/t1/run" },
];

describe("RBAC: viewer cannot reach state-changing automation/task routes", () => {
  for (const route of MUTATING_ROUTES) {
    test(`${route.method} ${route.path} -> 403 for viewer`, async () => {
      const { app, databaseAdapter, authService, calls } = createApp();
      await seedUser(databaseAdapter, authService, "viewer@example.com", "viewer");
      const viewer = await loginUserSession(app, "viewer@example.com", PASSWORD, ORG_ID);

      const response = await app.fetch(
        new Request(`http://localhost:4310${route.path}`, {
          method: route.method,
          headers: viewer.headers({ "X-CSRF-Token": viewer.csrfToken }),
          body: route.body ? JSON.stringify(route.body) : undefined,
        }),
      );

      expect(response.status).toBe(403);
      // Guard must reject before any service/agent side effect runs.
      expect(calls).toEqual([]);
    });
  }
});

describe("RBAC: admin can still reach the same routes (not a 403)", () => {
  test("POST /v1/automations is not forbidden for admin", async () => {
    const { app, databaseAdapter, authService } = createApp();
    await seedUser(databaseAdapter, authService, "admin@example.com", "admin");
    const admin = await loginUserSession(app, "admin@example.com", PASSWORD, ORG_ID);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        method: "POST",
        headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
        body: JSON.stringify({ name: "x", prompt: "x" }),
      }),
    );

    expect(response.status).not.toBe(403);
  });
});
