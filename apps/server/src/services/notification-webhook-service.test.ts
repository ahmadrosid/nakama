import { describe, expect, test } from "bun:test";
import type { NotificationDestinationChannel } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "./auth-service";
import { NotificationWebhookService } from "./notification-webhook-service";

describe("NotificationWebhookService", () => {
  async function seedDestination(options?: {
    apiKey?: string;
    secretHash?: string;
    channel?: NotificationDestinationChannel;
    channelId?: string;
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
    const channel = options?.channel ?? "telegram";

    const configured =
      channel === "telegram"
        ? {
            channel,
            config: { chatId: 1001, profileId: "agent_1", topicId: 22 },
          }
        : channel === "discord"
          ? {
              channel,
              config: {
                channelId: options?.channelId ?? "123456789012345678",
                profileId: "agent_1",
              },
            }
          : { channel, config: { profileId: "agent_1" } };

    await databaseAdapter.upsertNotificationDestination({
      ...configured,
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: options?.secretHash ?? authService.hashToken(apiKey),
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    return { apiKey, authService, databaseAdapter };
  }

  for (const channel of ["telegram", "discord", "whatsapp"] as const) {
    test(`${channel} selects only its adapter and rejects concurrent duplicates`, async () => {
      const { apiKey, authService, databaseAdapter } = await seedDestination({
        channel,
      });

      const calls: Array<{ channel: string; input: unknown }> = [];

      const service = new NotificationWebhookService(
        databaseAdapter,
        authService,
        {
          discord: {
            send: async (input) => {
              calls.push({ channel: "discord", input });

              return { ok: true };
            },
          },
          telegram: {
            send: async (input) => {
              calls.push({ channel: "telegram", input });

              return { ok: true };
            },
          },
          whatsapp: {
            send: async (input) => {
              calls.push({ channel: "whatsapp", input });

              return { ok: true };
            },
          },
        }
      );

      const results = await Promise.allSettled([
        service.deliver(
          "dest_1",
          apiKey,
          { body: "Received", level: "success", title: "Payment" },
          "evt_1"
        ),
        service.deliver(
          "dest_1",
          apiKey,
          { body: "Received", level: "success", title: "Payment" },
          "evt_1"
        ),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected")
      ).toMatchObject({ reason: { status: 409 } });

      const target =
        channel === "telegram"
          ? { chatIds: [1001], parseMode: "HTML", topicId: 22 }
          : channel === "discord"
            ? { channelId: "123456789012345678" }
            : {};

      expect(calls).toEqual([
        {
          channel,
          input: {
            ...target,
            orgId: "org_1",
            profileId: "agent_1",
            text:
              channel === "whatsapp"
                ? "✅ Payment\n\nReceived"
                : "✅ **Payment**\n\nReceived",
          },
        },
      ]);
    });

    test(`${channel} keeps claims after failed delivery`, async () => {
      const { apiKey, authService, databaseAdapter } = await seedDestination({
        channel,
      });

      let sends = 0;

      const adapter = {
        send: async () => {
          sends += 1;

          return { error: "offline", ok: false };
        },
      };

      const service = new NotificationWebhookService(
        databaseAdapter,
        authService,
        { discord: adapter, telegram: adapter, whatsapp: adapter }
      );

      await expect(
        service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_failure")
      ).rejects.toMatchObject({ status: 502 });
      await expect(
        service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_failure")
      ).rejects.toMatchObject({ status: 409 });
      expect(sends).toBe(1);
    });

    test(`${channel} refuses agents outside the destination's organization`, async () => {
      const { apiKey, authService, databaseAdapter } = await seedDestination({
        channel,
      });

      const profile = await databaseAdapter.getProfile("agent_1");

      if (!profile) {
        throw new Error("Missing test profile");
      }

      await databaseAdapter.upsertProfile({ ...profile, orgId: "org_2" });
      let sends = 0;

      const adapter = {
        send: async () => {
          sends += 1;

          return { ok: true };
        },
      };

      const service = new NotificationWebhookService(
        databaseAdapter,
        authService,
        { discord: adapter, telegram: adapter, whatsapp: adapter }
      );

      await expect(
        service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_scope")
      ).rejects.toMatchObject({ status: 409 });
      expect(sends).toBe(0);
      expect(
        await databaseAdapter.claimNotificationWebhookDelivery(
          "dest_1",
          "evt_scope",
          new Date().toISOString()
        )
      ).toBe(true);
    });
  }

  test("invalid stored Discord targets cannot trigger paired-user broadcast or claim a delivery", async () => {
    for (const channelId of ["", "../users/@me", "123"]) {
      const { apiKey, authService, databaseAdapter } = await seedDestination({
        channel: "discord",
        channelId,
      });

      let sends = 0;

      const adapter = {
        send: async () => {
          sends += 1;

          return { ok: true };
        },
      };

      const service = new NotificationWebhookService(
        databaseAdapter,
        authService,
        { discord: adapter, telegram: adapter, whatsapp: adapter }
      );

      await expect(
        service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_bad_target")
      ).rejects.toMatchObject({ status: 409 });
      expect(sends).toBe(0);
      expect(
        await databaseAdapter.claimNotificationWebhookDelivery(
          "dest_1",
          "evt_bad_target",
          new Date().toISOString()
        )
      ).toBe(true);
    }
  });

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
        telegram: {
          send: async (input) => {
            calls.push(input);

            return { ok: true };
          },
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
        telegram: {
          send: async () => ({ ok: true }),
        },
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
        telegram: {
          send: async () => ({ ok: true }),
        },
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
        telegram: {
          send: async () => {
            sendCount += 1;

            return { ok: true };
          },
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

  test("keeps the claim when telegram delivery fails so a retry cannot double-send", async () => {
    const { apiKey, authService, databaseAdapter } = await seedDestination();
    let sendCount = 0;

    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        telegram: {
          send: async () => {
            sendCount += 1;

            return { error: "telegram down", ok: false };
          },
        },
      }
    );

    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_retry_1")
    ).rejects.toMatchObject({ status: 502 });

    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_retry_1")
    ).rejects.toMatchObject({ status: 409 });

    expect(sendCount).toBe(1);
  });

  test("allows the same idempotency key again after the replay window is pruned", async () => {
    const { apiKey, authService, databaseAdapter } = await seedDestination();
    let sendCount = 0;

    const service = new NotificationWebhookService(
      databaseAdapter,
      authService,
      {
        telegram: {
          send: async () => {
            sendCount += 1;

            return { ok: true };
          },
        },
      }
    );

    expect(
      await databaseAdapter.claimNotificationWebhookDelivery(
        "dest_1",
        "evt_window_1",
        "2020-01-01T00:00:00.000Z"
      )
    ).toBe(true);

    await expect(
      service.deliver("dest_1", apiKey, { body: "Hello" }, "evt_window_1")
    ).resolves.toBeUndefined();

    expect(sendCount).toBe(1);
  });
});
