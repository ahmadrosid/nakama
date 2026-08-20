import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "./auth-service";
import { NotificationWebhookService } from "./notification-webhook-service";

describe("NotificationWebhookService", () => {
  test("delivers to telegram topics with formatted text", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const apiKey = "secret_key";
    const calls: Array<{
      text: string;
      chatIds?: number[];
      topicId?: number;
      parseMode?: "HTML";
    }> = [];

    await databaseAdapter.upsertOrganization({
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "org_1",
      name: "Acme",
      slug: "acme",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });
    await databaseAdapter.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1001, topicId: 22 },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: authService.hashToken(apiKey),
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        send: async (input) => {
          calls.push(input);
          return { ok: true };
        },
      }
    );

    await expect(
      service.deliver("dest_1", apiKey, {
        body: "Customer: Ahmad",
        level: "success",
        title: "New payment received",
      })
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        chatIds: [1001],
        parseMode: "HTML",
        text: "✅ **New payment received**\n\nCustomer: Ahmad",
        topicId: 22,
      },
    ]);
  });

  test("rejects invalid credentials", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();

    await databaseAdapter.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1001, topicId: null },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: authService.hashToken("secret_key"),
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        send: async () => ({ ok: true }),
      }
    );

    await expect(
      service.deliver("dest_1", "wrong", { body: "Hello" })
    ).rejects.toMatchObject({ status: 401 });
  });
});
