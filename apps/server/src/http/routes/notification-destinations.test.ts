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
  for (const channel of ["discord", "whatsapp"] as const) {
    test(`${channel} destinations support CRUD and enforce ownership`, async () => {
      const { app, databaseAdapter } = createApp();

      const { email, password, orgId } = await seedOrgAdmin(databaseAdapter, {
        profileId: "agent_1",
      });

      const session = await loginUserSession(app, email, password, orgId);

      const headers = session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      });

      const config =
        channel === "discord"
          ? { profileId: "agent_1", channelId: "12345678901234567890" }
          : { profileId: "agent_1" };

      const request = { channel, name: "Ops", [channel]: config };

      const createdResponse = await app.fetch(
        new Request("http://localhost:4310/v1/notification-destinations", {
          method: "POST",
          headers,
          body: JSON.stringify(request),
        })
      );

      expect(createdResponse.status).toBe(200);
      const created = await createdResponse.json();
      expect(created.destination).toMatchObject(request);
      expect(created.apiKey).toBeTruthy();
      const url = `http://localhost:4310/v1/notification-destinations/${created.destination.id}`;

      const updatedResponse = await app.fetch(
        new Request(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...request, name: "Updated" }),
        })
      );

      expect(updatedResponse.status).toBe(200);
      expect(await updatedResponse.json()).toMatchObject({
        ...request,
        name: "Updated",
      });

      const wrongChannel = await app.fetch(
        new Request(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            channel: "telegram",
            name: "Wrong",
            telegram: { profileId: "agent_1", chatId: 1 },
          }),
        })
      );

      expect(wrongChannel.status).toBe(400);

      const foreignProfile = await app.fetch(
        new Request(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            ...request,
            [channel]: { ...config, profileId: "foreign_agent" },
          }),
        })
      );

      expect(foreignProfile.status).toBe(400);

      const other = await seedOrgAdmin(databaseAdapter, {
        email: "other@example.com",
        userId: "other_user",
        orgId: "other_org",
        profileId: "other_agent",
      });

      const otherSession = await loginUserSession(
        app,
        other.email,
        other.password,
        other.orgId
      );

      const otherHeaders = otherSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": otherSession.csrfToken,
      });

      for (const [method, path] of [
        ["PUT", url],
        ["DELETE", url],
        ["POST", `${url}/rotate-key`],
      ]) {
        const response = await app.fetch(
          new Request(path!, {
            method,
            headers: otherHeaders,
            body: method === "PUT" ? JSON.stringify(request) : undefined,
          })
        );

        expect(response.status).toBe(404);
      }

      const wrongOwnerCreate = await app.fetch(
        new Request("http://localhost:4310/v1/notification-destinations", {
          method: "POST",
          headers: otherHeaders,
          body: JSON.stringify(request),
        })
      );

      expect(wrongOwnerCreate.status).toBe(400);

      const list = await app.fetch(
        new Request("http://localhost:4310/v1/notification-destinations", {
          headers: session.headers(),
        })
      );

      expect(await list.json()).toMatchObject({
        destinations: [
          {
            id: created.destination.id,
            channel,
            name: "Updated",
            [channel]: config,
          },
        ],
      });

      const rotatedResponse = await app.fetch(
        new Request(`${url}/rotate-key`, { method: "POST", headers })
      );

      expect(rotatedResponse.status).toBe(200);
      const rotated = await rotatedResponse.json();
      expect(rotated.apiKey).not.toBe(created.apiKey);
      expect(rotated.destination).toMatchObject({ channel, [channel]: config });

      const deleted = await app.fetch(
        new Request(url, { method: "DELETE", headers })
      );

      expect(deleted.status).toBe(204);
      expect(
        await databaseAdapter.getNotificationDestination(created.destination.id)
      ).toBeNull();
    });

    test(`viewers cannot manage ${channel} destinations`, async () => {
      const { app, databaseAdapter } = createApp();

      const user = await seedOrgAdmin(databaseAdapter, {
        profileId: "agent_1",
        role: "viewer",
      });

      const session = await loginUserSession(
        app,
        user.email,
        user.password,
        user.orgId
      );

      const headers = session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      });

      const request = {
        channel,
        name: "Ops",
        [channel]: {
          profileId: "agent_1",
          channelId: channel === "discord" ? "123456789012345678" : undefined,
        },
      };

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/notification-destinations", {
          method: "POST",
          headers,
          body: JSON.stringify(request),
        })
      );

      expect(response.status).toBe(403);
      expect(
        await databaseAdapter.listNotificationDestinationsForOrg(user.orgId)
      ).toEqual([]);
    });
  }

  test("org admin can create, list, rotate, and delete destinations", async () => {
    const { app, databaseAdapter } = createApp();

    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "agent_1",
    });

    const session = await loginUserSession(app, email, password, orgId);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/notification-destinations", {
        body: JSON.stringify({
          channel: "telegram",
          name: "Payments",
          telegram: { profileId: "agent_1", chatId: 1001, topicId: 22 },
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
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
    // SAFETY: This test controls the fixture shape at this boundary.
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
