import { describe, expect, test } from "bun:test";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { AgentService } from "../services/agent-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupFreshInstallSession } from "./test-session-helpers";
import { setupTestConfigDir } from "../test-config-dir";

setupTestConfigDir("nakama-user-context-test-");

describe("user context routes", () => {
  test("stores USER.md per authenticated member", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      workerManager: {} as any,
      mcpService: {} as any,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);
    const org1Id = session.orgId!;
    const user = await databaseAdapter.getUserByEmail("admin@example.com");
    expect(user).not.toBeNull();
    const now = new Date().toISOString();
    await databaseAdapter.upsertOrganization({
      id: "org_second",
      name: "Second Org",
      slug: "second-org",
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      orgId: "org_second",
      userId: user!.id,
      role: "member",
      createdAt: now,
    });

    const initResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context/init", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
        }),
      }),
    );
    expect(initResponse.status).toBe(201);
    const initBody = (await initResponse.json()) as { created: boolean };
    expect(initBody.created).toBe(true);

    const getResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context?content=true", {
        headers: session.headers(),
      }),
    );
    expect(getResponse.status).toBe(200);
    const status = (await getResponse.json()) as { active: boolean; content?: string };
    expect(status.active).toBe(true);
    expect(status.content).toContain("# About Me");

    const writeResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context", {
        method: "PUT",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ content: "# About Me\n\nAlice from Acme" }),
      }),
    );
    expect(writeResponse.status).toBe(204);

    expect(await databaseAdapter.getUserContext(org1Id, user!.id)).toBe("# About Me\n\nAlice from Acme");

    const writeSecondOrgResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context", {
        method: "PUT",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }, "org_second"),
        body: JSON.stringify({ content: "# About Me\n\nAlice from Second Org" }),
      }),
    );
    expect(writeSecondOrgResponse.status).toBe(204);

    expect(await databaseAdapter.getUserContext(org1Id, user!.id)).toBe("# About Me\n\nAlice from Acme");
    expect(await databaseAdapter.getUserContext("org_second", user!.id)).toBe("# About Me\n\nAlice from Second Org");
  });
});
