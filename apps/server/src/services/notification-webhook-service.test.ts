import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
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

    await databaseAdapter.upsertNotificationDestination({
      id: "dest_1",
      name: "Payments",
      channel: "telegram",
      config: { chatId: 1001, topicId: 22 },
      secretHash: authService.hashToken(apiKey),
      orgId: "org_1",
      createdAt: "2026-07-04T10:00:00.000Z",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    const service = new NotificationWebhookService(databaseAdapter, authService, {
      send: async (input) => {
        calls.push(input);
        return { ok: true };
      },
    });

    await expect(
      service.deliver("dest_1", apiKey, {
        title: "New payment received",
        body: "Customer: Ahmad",
        level: "success",
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        text: "✅ **New payment received**\n\nCustomer: Ahmad",
        chatIds: [1001],
        topicId: 22,
        parseMode: "HTML",
      },
    ]);
  });

  test("rejects invalid credentials", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();

    await databaseAdapter.upsertNotificationDestination({
      id: "dest_1",
      name: "Payments",
      channel: "telegram",
      config: { chatId: 1001, topicId: null },
      secretHash: authService.hashToken("secret_key"),
      orgId: "org_1",
      createdAt: "2026-07-04T10:00:00.000Z",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    const service = new NotificationWebhookService(databaseAdapter, authService, {
      send: async () => ({ ok: true }),
    });

    await expect(service.deliver("dest_1", "wrong", { body: "Hello" })).rejects.toMatchObject(
      { status: 401 },
    );
  });
});
