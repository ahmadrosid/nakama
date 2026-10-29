import { describe, expect, test } from "bun:test";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
} from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-rbac-mutations-test-");

const ORG_ID = "org_test";

const PASSWORD = "password123";

test("automation run deletion is unavailable and preserves history", async () => {
  const { app, databaseAdapter } = createMinimalHonoApp();
  const admin = await setupFreshInstallSession(app, databaseAdapter);
  const profile = await seedOrgDefaultProfile(databaseAdapter, admin.orgId!);
  const now = new Date().toISOString();
  await databaseAdapter.upsertAutomation({
    createdAt: now,
    definition: {},
    enabled: true,
    id: "automation_keep",
    name: "Keep history",
    orgId: admin.orgId!,
    profileId: profile.id,
    updatedAt: now,
    version: 1,
  });

  const run = {
    automationId: "automation_keep",
    completedAt: now,
    error: null,
    id: "run_keep",
    output: "Saved output",
    startedAt: now,
    status: "completed" as const,
  };

  await databaseAdapter.insertAutomationRun(run);

  const response = await app.fetch(
    new Request(
      "http://localhost:4310/v1/automations/automation_keep/runs/run_keep",
      {
        headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
        method: "DELETE",
      }
    )
  );

  expect(response.status).toBe(404);
  expect(
    await databaseAdapter.getAutomationRun(run.automationId, run.id)
  ).toMatchObject(run);

  const specResponse = await app.fetch(
    new Request("http://localhost:4310/openapi.json", {
      headers: admin.headers(),
    })
  );

  expect(specResponse.status).toBe(200);
  const spec = await specResponse.json();
  expect(
    spec.paths["/v1/automations/{automationId}/runs/{runId}"]
  ).toBeUndefined();
});

function createApp() {
  const calls: string[] = [];

  const record =
    (name: string) =>
    async (..._args: unknown[]) => {
      calls.push(name);

      // SAFETY: This test controls the fixture shape at this boundary.
      return { id: "x", name: "x", prompt: "x" } as any;
    };

  const result = createMinimalHonoApp({
    agent: {
      branchSession: record("agent.branchSession"),
      clearSession: record("agent.clearSession"),
      compactSession: record("agent.compactSession"),
      createSession: record("agent.createSession"),
      draftAutomation: record("agent.draftAutomation"),
      generateImage: record("agent.generateImage"),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      purgeSession: record("agent.purgeSession"),
      runAutomation: async () => {
        calls.push("agent.runAutomation");

        return { skipped: false };
      },
      transcribeAudio: record("agent.transcribeAudio"),
    },
    automationService: {
      create: record("automationService.create"),
      delete: record("automationService.delete"),
      get: async () => ({ id: "a", name: "a", prompt: "x" }),
      listRuns: async () => [{ id: "r", status: "ok" }],
      update: record("automationService.update"),
    },
  });

  return { ...result, calls };
}

// State-changing routes require organization membership.
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
    {
      body: { channel: "web", profileId: "default" },
      method: "POST",
      path: "/v1/sessions",
    },
    { method: "DELETE", path: "/v1/sessions/s1" },
    { method: "DELETE", path: "/v1/sessions/s1?purge=true" },
    { body: { force: true }, method: "POST", path: "/v1/sessions/s1/compact" },
    {
      body: { messageIndex: 0 },
      method: "POST",
      path: "/v1/sessions/s1/branch",
    },
    {
      body: { audioBase64: "YQ==", mimeType: "audio/wav" },
      method: "POST",
      path: "/v1/audio/transcribe",
    },
    {
      body: { prompt: "a cat" },
      method: "POST",
      path: "/v1/images/generate",
    },
  ];

describe("RBAC: removed member cannot reach state-changing automation/session routes", () => {
  for (const route of MUTATING_ROUTES) {
    test(`${route.method} ${route.path} -> 404 for removed member`, async () => {
      const { app, databaseAdapter, authService, calls } = createApp();
      await seedOrgAdmin(databaseAdapter, {
        authService,
        email: "member@example.com",
        orgId: ORG_ID,
        password: PASSWORD,
        role: "member",
        userId: "user_secondary_member",
      });

      const member = await loginUserSession(
        app,
        "member@example.com",
        PASSWORD,
        ORG_ID
      );

      await databaseAdapter.deleteOrgMember(ORG_ID, "user_secondary_member");

      const response = await app.fetch(
        new Request(`http://localhost:4310${route.path}`, {
          body: route.body ? JSON.stringify(route.body) : undefined,
          headers: member.headers({ "X-CSRF-Token": member.csrfToken }),
          method: route.method,
        })
      );

      expect(response.status).toBe(404);
      // Guard must reject before any service/agent side effect runs.
      expect(calls).toEqual([]);
    });
  }
});

describe("RBAC: admin can still reach the same routes (not a 403)", () => {
  test.each(["admin", "member"] as const)(
    "messaging Super Nakama sessions enforce the authenticated %s role",
    async (role) => {
      const databaseAdapter = createInMemoryDatabaseAdapter();
      const agent = new AgentService(null, null, databaseAdapter);

      const { app, authService } = createMinimalHonoApp({
        agent,
        databaseAdapter,
      });

      const email = `${role}@example.com`;
      await seedOrgAdmin(databaseAdapter, {
        authService,
        email,
        orgId: ORG_ID,
        password: PASSWORD,
        role,
        userId: `user_${role}`,
      });
      const profile = await seedOrgDefaultProfile(databaseAdapter, ORG_ID);
      await databaseAdapter.upsertProfile({ ...profile, isSuper: true });
      const session = await loginUserSession(app, email, PASSWORD, ORG_ID);

      for (const channel of ["telegram", "whatsapp", "discord"]) {
        const response = await app.fetch(
          new Request("http://localhost:4310/v1/sessions", {
            body: JSON.stringify({ channel, profileId: profile.id }),
            headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
            method: "POST",
          })
        );

        expect(response.status).toBe(role === "admin" ? 201 : 403);

        if (role === "admin") {
          // SAFETY: This test controls the fixture shape at this boundary.
          const body = (await response.json()) as { sessionId: string };
          expect(
            await databaseAdapter.getSession(body.sessionId)
          ).toMatchObject({
            channel,
            profileId: profile.id,
            userId: "user_admin",
          });
        }
      }
    }
  );
});

test("force deleting an MCP server requires a platform admin", async () => {
  const calls: Array<[string, boolean]> = [];

  const { app, authService, databaseAdapter } = createMinimalHonoApp({
    mcpService: {
      deleteServer: async (serverId: string, force: boolean) => {
        calls.push([serverId, force]);
      },
    },
  });

  const platformAdmin = await setupFreshInstallSession(app, databaseAdapter);
  const orgId = platformAdmin.orgId!;
  await seedOrgAdmin(databaseAdapter, {
    authService,
    email: "org-admin@example.com",
    orgId,
    password: PASSWORD,
    role: "admin",
    userId: "user_org_admin",
  });

  const orgAdmin = await loginUserSession(
    app,
    "org-admin@example.com",
    PASSWORD,
    orgId
  );

  const url = "http://localhost:4310/v1/mcp/servers/mcp_test?force=true";

  const denied = await app.fetch(
    new Request(url, {
      headers: orgAdmin.headers({ "X-CSRF-Token": orgAdmin.csrfToken }),
      method: "DELETE",
    })
  );

  expect(denied.status).toBe(403);
  expect(calls).toEqual([]);

  const allowed = await app.fetch(
    new Request(url, {
      headers: platformAdmin.headers({
        "X-CSRF-Token": platformAdmin.csrfToken,
      }),
      method: "DELETE",
    })
  );

  expect(allowed.status).toBe(204);
  expect(calls).toEqual([["mcp_test", true]]);
});
