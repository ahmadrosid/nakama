import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { saveTelegramConfig } from "@tinyclaw/core";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";

describe("notification webhook routes", () => {
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  async function createApp() {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-notify-webhook-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await saveTelegramConfig({ botToken: "1234567890:TEST" });

    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: {} as any,
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: {} as any,
      workerManager: {} as any,
      mcpService: {} as any,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    });

    return { app, databaseAdapter, authService };
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
      await databaseAdapter.upsertNotificationDestination({
        id: "dest_1",
        name: "Payments",
        channel: "telegram",
        config: { chatId: 1001, topicId: 22 },
        secretHash: authService.hashToken("secret_key"),
        orgId: "org_1",
        createdAt: "2026-07-04T10:00:00.000Z",
        updatedAt: "2026-07-04T10:00:00.000Z",
      });

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/notify/dest_1", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "secret_key",
          },
          body: JSON.stringify({
            title: "New payment received",
            body: "Customer: Ahmad",
            level: "success",
          }),
        }),
      );

      expect(response.status).toBe(204);
      expect(telegramCalls[0]).toEqual({
        chat_id: 1001,
        text: "✅ <b>New payment received</b>\n\nCustomer: Ahmad",
        parse_mode: "HTML",
        message_thread_id: 22,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects invalid webhook credentials", async () => {
    const { app, databaseAdapter, authService } = await createApp();

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

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/notify/dest_1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "wrong",
        },
        body: JSON.stringify({ body: "Hello" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
