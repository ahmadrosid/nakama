import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  return createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    databaseAdapter,
  });
}

describe("notification destination routes", () => {
  test("org admin can create, list, rotate, and delete destinations", async () => {
    const { app, databaseAdapter } = createApp();
    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter);

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
