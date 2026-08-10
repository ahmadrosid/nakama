import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@nakama/core";
import type { AuthService } from "../../services/auth-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession } from "../test-session-helpers";

setupTestConfigDir("nakama-rbac-mutations-test-");

const ORG_ID = "org_test";
const PASSWORD = "password123";

function createApp() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (..._args: unknown[]) => {
      calls.push(name);
      return { id: "x", name: "x", prompt: "x" } as any;
    };

  const result = createMinimalHonoApp({
    agent: {
      draftAutomation: record("agent.draftAutomation"),
      draftTaskPrompt: record("agent.draftTaskPrompt"),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      runAutomation: async () => {
        calls.push("agent.runAutomation");
        return { skipped: false };
      },
      runTask: async () => {
        calls.push("agent.runTask");
        return { skipped: false };
      },
    },
    automationService: {
      create: record("automationService.create"),
      delete: record("automationService.delete"),
      deleteRun: record("automationService.deleteRun"),
      get: async () => ({ id: "a", name: "a", prompt: "x" }),
      listRuns: async () => [{ id: "r", status: "ok" }],
      update: record("automationService.update"),
    },
    taskService: {
      create: record("taskService.create"),
      delete: record("taskService.delete"),
      get: async () => ({ id: "t", status: "todo" }),
      listRuns: async () => [{ id: "r", status: "ok" }],
      update: record("taskService.update"),
    },
  });

  return { ...result, calls };
}

async function seedUser(
  databaseAdapter: ReturnType<typeof createApp>["databaseAdapter"],
  authService: AuthService,
  email: string,
  role: OrgRole
) {
  const now = new Date().toISOString();
  const userId = `user_${role}`;
  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id: userId,
    passwordHash: await authService.hashPassword(PASSWORD),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId: ORG_ID,
    role,
    userId,
  });
}

// State-changing routes a viewer must not be able to reach.
const MUTATING_ROUTES: Array<{ method: string; path: string; body?: unknown }> =
  [
    {
      body: { channel: "web", prompt: "x" },
      method: "POST",
      path: "/v1/automations/draft",
    },
    {
      body: { name: "x", prompt: "x" },
      method: "POST",
      path: "/v1/automations",
    },
    { body: { name: "x" }, method: "PUT", path: "/v1/automations/a1" },
    { method: "DELETE", path: "/v1/automations/a1" },
    { method: "POST", path: "/v1/automations/a1/run" },
    { method: "DELETE", path: "/v1/automations/a1/runs/r1" },
    {
      body: { description: "x", title: "x" },
      method: "POST",
      path: "/v1/tasks/draft-prompt",
    },
    { body: { prompt: "x", title: "x" }, method: "POST", path: "/v1/tasks" },
    { body: { title: "x" }, method: "PUT", path: "/v1/tasks/t1" },
    { method: "DELETE", path: "/v1/tasks/t1" },
    { method: "POST", path: "/v1/tasks/t1/run" },
  ];

describe("RBAC: viewer cannot reach state-changing automation/task routes", () => {
  for (const route of MUTATING_ROUTES) {
    test(`${route.method} ${route.path} -> 403 for viewer`, async () => {
      const { app, databaseAdapter, authService, calls } = createApp();
      await seedUser(
        databaseAdapter,
        authService,
        "viewer@example.com",
        "viewer"
      );
      const viewer = await loginUserSession(
        app,
        "viewer@example.com",
        PASSWORD,
        ORG_ID
      );

      const response = await app.fetch(
        new Request(`http://localhost:4310${route.path}`, {
          body: route.body ? JSON.stringify(route.body) : undefined,
          headers: viewer.headers({ "X-CSRF-Token": viewer.csrfToken }),
          method: route.method,
        })
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
    const admin = await loginUserSession(
      app,
      "admin@example.com",
      PASSWORD,
      ORG_ID
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        body: JSON.stringify({ name: "x", prompt: "x" }),
        headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).not.toBe(403);
  });
});
