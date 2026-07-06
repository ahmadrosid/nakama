import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { AgentService } from "../../services/agent-service";
import { OrgService } from "../../services/org-service";
import { loginUserSession } from "../test-session-helpers";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  return {
    databaseAdapter,
    app: createHonoApp({
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
    }),
  };
}

describe("notification destination routes", () => {
  test("org admin can create, list, rotate, and delete destinations", async () => {
    const { app, databaseAdapter } = createApp();
    const email = "admin@example.com";
    const password = "password123";
    const orgId = "org_test";
    const now = new Date().toISOString();

    const authService = new AuthService();
    await databaseAdapter.createUser({
      id: "user_admin",
      email,
      passwordHash: await authService.hashPassword(password),
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.upsertOrganization({
      id: orgId,
      name: "Test Org",
      slug: "test-org",
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      orgId,
      userId: "user_admin",
      role: "admin",
      createdAt: now,
    });

    const session = await loginUserSession(app, email, password, orgId);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/notification-destinations", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: "Payments",
          channel: "telegram",
          telegram: { chatId: 1001, topicId: 22 },
        }),
      }),
    );

    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      destination: { id: string; webhookPath: string };
      apiKey: string;
    };
    expect(created.destination.webhookPath).toBe(
      `/v1/notify/${encodeURIComponent(created.destination.id)}`,
    );
    expect(created.apiKey).toBeTruthy();

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/notification-destinations", {
        headers: session.headers(),
      }),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      destinations: [expect.objectContaining({ id: created.destination.id, name: "Payments" })],
    });

    const rotateResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/notification-destinations/${encodeURIComponent(created.destination.id)}/rotate-key`,
        {
          method: "POST",
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
        },
      ),
    );
    expect(rotateResponse.status).toBe(200);
    const rotated = (await rotateResponse.json()) as { apiKey: string };
    expect(rotated.apiKey).toBeTruthy();
    expect(rotated.apiKey).not.toBe(created.apiKey);

    const deleteResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/notification-destinations/${encodeURIComponent(created.destination.id)}`,
        {
          method: "DELETE",
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
        },
      ),
    );
    expect(deleteResponse.status).toBe(204);
  });
});
