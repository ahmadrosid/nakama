import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../services/agent-service";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-user-context-test-");

describe("user context routes", () => {
  test("stores USER.md per authenticated member", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      taskService: {} as any,
      webDistDir: null,
      workerManager: {} as any,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);
    const org1Id = session.orgId!;
    const user = await databaseAdapter.getUserByEmail("admin@example.com");
    expect(user).not.toBeNull();
    const now = new Date().toISOString();
    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_second",
      name: "Second Org",
      slug: "second-org",
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: "org_second",
      role: "member",
      userId: user!.id,
    });

    const initResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context/init", {
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(initResponse.status).toBe(201);
    const initBody = (await initResponse.json()) as { created: boolean };
    expect(initBody.created).toBe(true);

    const getResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context?content=true", {
        headers: session.headers(),
      })
    );
    expect(getResponse.status).toBe(200);
    const status = (await getResponse.json()) as {
      active: boolean;
      content?: string;
    };
    expect(status.active).toBe(true);
    expect(status.content).toContain("# About Me");

    const writeResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context", {
        body: JSON.stringify({ content: "# About Me\n\nAlice from Acme" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(writeResponse.status).toBe(204);

    expect(await databaseAdapter.getUserContext(org1Id, user!.id)).toBe(
      "# About Me\n\nAlice from Acme"
    );

    const writeSecondOrgResponse = await app.fetch(
      new Request("http://localhost:4310/v1/user/context", {
        body: JSON.stringify({
          content: "# About Me\n\nAlice from Second Org",
        }),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          "org_second"
        ),
        method: "PUT",
      })
    );
    expect(writeSecondOrgResponse.status).toBe(204);

    expect(await databaseAdapter.getUserContext(org1Id, user!.id)).toBe(
      "# About Me\n\nAlice from Acme"
    );
    expect(await databaseAdapter.getUserContext("org_second", user!.id)).toBe(
      "# About Me\n\nAlice from Second Org"
    );
  });
});
