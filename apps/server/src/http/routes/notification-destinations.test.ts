import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import { loginUserSession } from "../test-session-helpers";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  return {
    app: createHonoApp({
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
    }),
    databaseAdapter,
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
      createdAt: now,
      email,
      id: "user_admin",
      passwordHash: await authService.hashPassword(password),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: orgId,
      name: "Test Org",
      slug: "test-org",
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "admin",
      userId: "user_admin",
    });

    const session = await loginUserSession(app, email, password, orgId);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/notification-destinations", {
        body: JSON.stringify({
          channel: "telegram",
          name: "Payments",
          telegram: { chatId: 1001, topicId: 22 },
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      destination: { id: string; webhookPath: string };
      apiKey: string;
    };
    expect(created.destination.webhookPath).toBe(
      `/v1/notify/${encodeURIComponent(created.destination.id)}`
    );
    expect(created.apiKey).toBeTruthy();

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/notification-destinations", {
        headers: session.headers(),
      })
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      destinations: [
        expect.objectContaining({
          id: created.destination.id,
          name: "Payments",
        }),
      ],
    });

    const rotateResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/notification-destinations/${encodeURIComponent(created.destination.id)}/rotate-key`,
        {
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(rotateResponse.status).toBe(200);
    const rotated = (await rotateResponse.json()) as { apiKey: string };
    expect(rotated.apiKey).toBeTruthy();
    expect(rotated.apiKey).not.toBe(created.apiKey);

    const deleteResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/notification-destinations/${encodeURIComponent(created.destination.id)}`,
        {
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "DELETE",
        }
      )
    );
    expect(deleteResponse.status).toBe(204);
  });
});
