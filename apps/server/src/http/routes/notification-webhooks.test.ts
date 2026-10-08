import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import {
  getDiscordConfigPath,
  getWhatsAppConfigPath,
  saveTelegramConfig,
} from "@nakama/core";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedOrgAdmin } from "../test-session-helpers";

describe("notification webhook routes", () => {
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { force: true, recursive: true });
      tempHome = "";
    }
  });

  async function createApp() {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-notify-webhook-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await saveTelegramConfig(
      { orgId: "org_1", profileId: "agent_1" },
      { botToken: "1234567890:TEST" }
    );

    return createMinimalHonoApp({
      agent: {},
      systemStatus: {},
    });
  }

  for (const channel of ["discord", "whatsapp"] as const) {
    test(`${channel} webhooks retain authentication, validation, and replay protection`, async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
      let providerStatus = 200;
      globalThis.fetch = async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
          headers: new Headers(init?.headers),
        });

        return new Response("ok", { status: providerStatus });
      };

      try {
        const { app, databaseAdapter, authService } = await createApp();
        await seedOrgAdmin(databaseAdapter, {
          orgId: "org_1",
          profileId: "agent_1",
        });
        const owner = { orgId: "org_1", profileId: "agent_1" };

        const configPath =
          channel === "discord"
            ? getDiscordConfigPath(owner)
            : getWhatsAppConfigPath(owner);

        await mkdir(path.dirname(configPath), { recursive: true });
        await writeFile(
          configPath,
          channel === "discord"
            ? "bot_token=test_discord_token\nprofile_id=agent_1\n"
            : "profile_id=agent_1\npaired_jid=628123456789@s.whatsapp.net\noutbound_port=4312\noutbound_token=test_worker_token\n"
        );

        const configured =
          channel === "discord"
            ? {
                channel,
                config: {
                  channelId: "12345678901234567890",
                  profileId: "agent_1",
                },
              }
            : { channel, config: { profileId: "agent_1" } };

        await databaseAdapter.upsertNotificationDestination({
          ...configured,
          id: "dest_1",
          name: "Ops",
          orgId: "org_1",
          secretHash: authService.hashToken("secret_key"),
          createdAt: "2026-10-03T00:00:00.000Z",
          updatedAt: "2026-10-03T00:00:00.000Z",
        });

        const notify = (
          key: string | null,
          payload: { body: string; level?: string; title?: string } = {
            title: "Payment",
            body: "Received",
            level: "success",
          },
          apiKey = "secret_key"
        ) => {
          const headers = new Headers({
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          });

          if (key) {
            headers.set("Idempotency-Key", key);
          }

          return app.fetch(
            new Request("http://localhost:4310/v1/notify/dest_1", {
              method: "POST",
              body: JSON.stringify(payload),
              headers,
            })
          );
        };

        expect((await notify("evt_wrong", undefined, "wrong")).status).toBe(
          401
        );
        expect((await notify(null)).status).toBe(400);
        expect((await notify("evt_bad_payload", { body: " " })).status).toBe(
          400
        );
        expect(calls).toEqual([]);
        expect((await notify("evt_1")).status).toBe(204);
        expect((await notify("evt_1")).status).toBe(409);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(
          channel === "discord"
            ? "https://discord.com/api/v10/channels/12345678901234567890/messages"
            : "http://127.0.0.1:4312/send"
        );
        expect(calls[0]?.body).toEqual(
          channel === "discord"
            ? {
                content: "✅ **Payment**\n\nReceived",
                allowed_mentions: { parse: [] },
              }
            : { text: "✅ Payment\n\nReceived" }
        );
        expect(
          calls[0]?.headers.get(
            channel === "discord" ? "authorization" : "x-nakama-token"
          )
        ).toBe(
          channel === "discord" ? "Bot test_discord_token" : "test_worker_token"
        );
        providerStatus = 503;
        expect((await notify("evt_failure")).status).toBe(502);
        expect((await notify("evt_failure")).status).toBe(409);
        expect(calls).toHaveLength(2);
        await databaseAdapter.deleteProfile("agent_1");
        expect((await notify("evt_deleted_agent")).status).toBe(409);
        expect(calls).toHaveLength(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  test("accepts authenticated webhook requests and delivers to telegram topics", async () => {
    const telegramCalls: Array<{
      chat_id?: number | string;
      message_thread_id?: number;
      text?: string;
    }> = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      telegramCalls.push(JSON.parse(String(init?.body)));

      return new Response("ok", { status: 200 });
    };

    try {
      const { app, databaseAdapter, authService } = await createApp();
      await seedOrgAdmin(databaseAdapter, {
        orgId: "org_1",
        profileId: "agent_1",
      });
      await databaseAdapter.upsertOrganization({
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "org_1",
        name: "Acme",
        slug: "acme",
        updatedAt: "2026-07-04T10:00:00.000Z",
      });
      await databaseAdapter.upsertNotificationDestination({
        channel: "telegram",
        config: { profileId: "agent_1", chatId: 1001, topicId: 22 },
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "dest_1",
        name: "Payments",
        orgId: "org_1",
        secretHash: authService.hashToken("secret_key"),
        updatedAt: "2026-07-04T10:00:00.000Z",
      });

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/notify/dest_1", {
          body: JSON.stringify({
            body: "Customer: Ahmad",
            level: "success",
            title: "New payment received",
          }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "evt_route_success_1",
            "X-API-Key": "secret_key",
          },
          method: "POST",
        })
      );

      expect(response.status).toBe(204);
      expect(telegramCalls[0]).toEqual({
        chat_id: 1001,
        message_thread_id: 22,
        parse_mode: "HTML",
        text: "✅ <b>New payment received</b>\n\nCustomer: Ahmad",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects invalid webhook credentials", async () => {
    const { app, databaseAdapter, authService } = await createApp();

    await databaseAdapter.upsertNotificationDestination({
      channel: "telegram",
      config: { profileId: "agent_1", chatId: 1001, topicId: null },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: authService.hashToken("secret_key"),
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/notify/dest_1", {
        body: JSON.stringify({ body: "Hello" }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "evt_route_invalid_1",
          "X-API-Key": "wrong",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
  });

  test("does not leak an unexpected internal failure's message", async () => {
    const { app, databaseAdapter } = await createApp();

    const lookupSpy = spyOn(
      databaseAdapter,
      "getNotificationDestination"
    ).mockImplementation(() => {
      throw new Error(
        "SQLITE_IOERR: disk I/O error at /home/nakama/.config/nakama/nakama.db"
      );
    });

    try {
      const response = await app.fetch(
        new Request("http://localhost:4310/v1/notify/dest_1", {
          body: JSON.stringify({ body: "Hello" }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "evt_route_internal_1",
            "X-API-Key": "secret_key",
          },
          method: "POST",
        })
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "An unexpected server error occurred.",
      });
    } finally {
      lookupSpy.mockRestore();
    }
  });

  test("rejects a replayed idempotency key without a second telegram send", async () => {
    const telegramCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      telegramCalls.push(init?.body);

      return new Response("ok", { status: 200 });
    };

    try {
      const { app, databaseAdapter, authService } = await createApp();
      await seedOrgAdmin(databaseAdapter, {
        orgId: "org_1",
        profileId: "agent_1",
      });
      await databaseAdapter.upsertOrganization({
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "org_1",
        name: "Acme",
        slug: "acme",
        updatedAt: "2026-07-04T10:00:00.000Z",
      });
      await databaseAdapter.upsertNotificationDestination({
        channel: "telegram",
        config: { profileId: "agent_1", chatId: 1001, topicId: 22 },
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "dest_1",
        name: "Payments",
        orgId: "org_1",
        secretHash: authService.hashToken("secret_key"),
        updatedAt: "2026-07-04T10:00:00.000Z",
      });

      const requestInit = {
        body: JSON.stringify({ body: "Customer: Ahmad" }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "evt_route_replay_1",
          "X-API-Key": "secret_key",
        },
        method: "POST" as const,
      };

      const first = await app.fetch(
        new Request("http://localhost:4310/v1/notify/dest_1", requestInit)
      );

      const second = await app.fetch(
        new Request("http://localhost:4310/v1/notify/dest_1", requestInit)
      );

      expect(first.status).toBe(204);
      expect(second.status).toBe(409);
      expect(telegramCalls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not deliver for an archived organization", async () => {
    const telegramCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      telegramCalls.push(init?.body);

      return new Response("ok", { status: 200 });
    };

    try {
      const { app, databaseAdapter, authService } = await createApp();
      await seedOrgAdmin(databaseAdapter, {
        orgId: "org_1",
        profileId: "agent_1",
      });
      await databaseAdapter.upsertOrganization({
        archivedAt: "2026-08-21T00:00:00.000Z",
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "org_1",
        name: "Acme",
        slug: "acme",
        updatedAt: "2026-08-21T00:00:00.000Z",
      });
      await databaseAdapter.upsertNotificationDestination({
        channel: "telegram",
        config: { profileId: "agent_1", chatId: 1001, topicId: null },
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "dest_1",
        name: "Payments",
        orgId: "org_1",
        secretHash: authService.hashToken("secret_key"),
        updatedAt: "2026-07-04T10:00:00.000Z",
      });

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/notify/dest_1", {
          body: JSON.stringify({ body: "Hello" }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "evt_route_archived_1",
            "X-API-Key": "secret_key",
          },
          method: "POST",
        })
      );

      expect(response.status).toBe(404);
      expect(telegramCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
