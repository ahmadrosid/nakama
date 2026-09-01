import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { saveTelegramConfig } from "@nakama/core";
import { createMinimalHonoApp } from "../test-app-helpers";

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
    await saveTelegramConfig({ botToken: "1234567890:TEST" });

    return createMinimalHonoApp({
      agent: {},
      systemStatus: {},
    });
  }

  test("accepts authenticated webhook requests and delivers to telegram topics", async () => {
    const telegramCalls: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      telegramCalls.push(JSON.parse(String(init?.body)));
      return new Response("ok", { status: 200 });
    };

    try {
      const { app, databaseAdapter, authService } = await createApp();
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
      config: { chatId: 1001, topicId: null },
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

  test("does not deliver for an archived organization", async () => {
    const telegramCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      telegramCalls.push(init?.body);
      return new Response("ok", { status: 200 });
    };

    try {
      const { app, databaseAdapter, authService } = await createApp();
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
        config: { chatId: 1001, topicId: null },
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
