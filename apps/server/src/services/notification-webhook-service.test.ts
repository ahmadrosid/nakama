import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "./auth-service";
import { NotificationWebhookService } from "./notification-webhook-service";

describe("NotificationWebhookService", () => {
  async function seedDestination(options?: {
    apiKey?: string;
    secretHash?: string;
  }) {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const apiKey = options?.apiKey ?? "secret_key";

    await databaseAdapter.upsertOrganization({
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "org_1",
      name: "Acme",
      slug: "acme",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });
    await databaseAdapter.upsertProfile({
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "agent_1",
      isSuper: false,
      model: "openrouter/auto",
      name: "Agent",
      orgId: "org_1",
      systemPrompt: "",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });
    await databaseAdapter.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1001, profileId: "agent_1", topicId: 22 },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: options?.secretHash ?? authService.hashToken(apiKey),
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    return { apiKey, authService, databaseAdapter };
  }

  test("delivers to telegram topics with formatted text", async () => {
    const { apiKey, authService, databaseAdapter } = await seedDestination();
    const calls: Array<{
      text: string;
      chatIds?: number[];
      topicId?: number;
      parseMode?: "HTML";
    }> = [];

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
      service.deliver(
        "dest_1",
        apiKey,
        {
          body: "Customer: Ahmad",
          level: "success",
          title: "New payment received",
        },
        "evt_payment_1"
      )
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        chatIds: [1001],
        orgId: "org_1",
        parseMode: "HTML",
        profileId: "agent_1",
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
      service.deliver("dest_1", "wrong", { body: "Hello" }, "evt_1")
    ).rejects.toMatchObject({ status: 401 });
  });

  test("requires an idempotency key", async () => {
    const { apiKey, authService, databaseAdapter } = await seedDestination();
    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        send: async () => ({ ok: true }),
      }
    );

    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, null)
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, "   ")
    ).rejects.toMatchObject({ status: 400 });
  });

  test("does not send twice for a repeated idempotency key", async () => {
    const { apiKey, authService, databaseAdapter } = await seedDestination();
    let sendCount = 0;
    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        send: async () => {
          sendCount += 1;
          return { ok: true };
        },
      }
    );

    const payload = { body: "Customer: Ahmad", level: "success" as const };
    await service.deliver("dest_1", apiKey, payload, "evt_replay_1");
    await expect(
      service.deliver("dest_1", apiKey, payload, "evt_replay_1")
    ).rejects.toMatchObject({ status: 409 });

    expect(sendCount).toBe(1);
  });

  test("releases the claim when telegram delivery fails so retries can send", async () => {
    const { apiKey, authService, databaseAdapter } = await seedDestination();
    let sendCount = 0;
    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        send: async () => {
          sendCount += 1;
          if (sendCount === 1) {
            return { error: "telegram down", ok: false };
          }
          return { ok: true };
        },
      }
    );

    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_retry_1")
    ).rejects.toMatchObject({ status: 502 });

    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_retry_1")
    ).resolves.toBeUndefined();

    expect(sendCount).toBe(2);
  });
});
