import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadDiscordConfigFile,
  loadTelegramConfigFile,
  loadWhatsAppConfigFile,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { asTestFetch } from "../providers/test-helpers";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

const TEST_ORG_ID = "org_test";

const ORG_ID = "org_test";

describe("AgentService bot token validation", () => {
  const originalFetch = globalThis.fetch;
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-bot-token-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  });

  test("rejects and does not persist a Telegram token rejected by Telegram", async () => {
    const botToken = "123456:QA-fake-token-xyz";
    let requestCount = 0;
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      requestCount += 1;

      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    });

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const error = await captureError(() =>
      service.setTelegramSettings(TEST_ORG_ID, { botToken })
    );

    const configured = (await service.getTelegramSettings(TEST_ORG_ID))
      .configured;

    expect({ configured, rejected: error !== null, requestCount }).toEqual({
      configured: false,
      rejected: true,
      requestCount: 1,
    });
    expect(error?.message).not.toContain(botToken);
    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toBeNull();
  });

  test("persists a Telegram token accepted by Telegram", async () => {
    let requestUrl = "";
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);

      return new Response(
        JSON.stringify({ ok: true, result: { id: 123_456, is_bot: true } }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    }) as typeof fetch;

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const saved = await service.setTelegramSettings(TEST_ORG_ID, {
      botToken: "123456:valid-token",
    });

    expect(saved.configured).toBe(true);
    expect(new URL(requestUrl).pathname).toBe("/bot123456%3Avalid-token/getMe");
    expect((await service.getTelegramSettings(TEST_ORG_ID)).configured).toBe(
      true
    );
  });

  test("rejects and does not persist a Discord token rejected by Discord", async () => {
    const botToken = "123456:QA-fake-token-xyz";
    let requestCount = 0;
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      requestCount += 1;

      return new Response(null, { status: 401 });
    });

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const error = await captureError(() =>
      service.setDiscordSettings({ botToken })
    );

    const configured = (await service.getDiscordSettings()).configured;

    expect({ configured, rejected: error !== null, requestCount }).toEqual({
      configured: false,
      rejected: true,
      requestCount: 1,
    });
    expect(error?.message).not.toContain(botToken);
    expect(await loadDiscordConfigFile()).toBeNull();
  });

  test("persists a Discord token accepted by Discord", async () => {
    let authorization = "";
    let requestCount = 0;
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = (async (_input, init) => {
      requestCount += 1;
      authorization = new Headers(init?.headers).get("Authorization") ?? "";

      return new Response(JSON.stringify({ id: "1525937133096013954" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const saved = await service.setDiscordSettings({
      botToken: "valid-discord-token",
    });

    expect(saved.configured).toBe(true);
    expect(authorization).toBe("Bot valid-discord-token");
    expect((await service.getDiscordSettings()).configured).toBe(true);
    expect(requestCount).toBe(1);
  });

  test("preserves Telegram config after a rejected replacement and on token-less edits", async () => {
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () =>
        new Response(
          JSON.stringify({ ok: true, result: { id: 123_456, is_bot: true } }),
          { status: 200 }
        )
    );

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    await service.setTelegramSettings(TEST_ORG_ID, {
      allowedUserIds: "42",
      botToken: "123456:original-token",
      profileId: "original",
    });
    const beforeReplacement = await loadTelegramConfigFile(TEST_ORG_ID);

    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () => new Response(null, { status: 401 })
    );
    await expect(
      service.setTelegramSettings(TEST_ORG_ID, {
        allowedUserIds: "43",
        botToken: "123456:rejected-token",
        profileId: "replacement",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toEqual(
      beforeReplacement
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      throw new Error("Token-less Telegram edits must not call the provider.");
    });
    await service.setTelegramSettings(TEST_ORG_ID, {
      allowedUserIds: "43",
      profileId: "edited",
    });
    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toMatchObject({
      allowedUserIds: [43],
      botToken: "123456:original-token",
      profileId: "edited",
    });
  });

  test("revalidates a cached Discord token and preserves config when rejected", async () => {
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () =>
        new Response(JSON.stringify({ id: "1525937133096013954" }), {
          status: 200,
        })
    );

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    await service.setDiscordSettings({
      allowedUserIds: "123456789012345678",
      botToken: "cached-discord-token",
      profileId: "original",
    });
    const beforeReplacement = await loadDiscordConfigFile();
    let rejectedRequestCount = 0;

    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      rejectedRequestCount += 1;

      return new Response(null, { status: 401 });
    });
    await expect(
      service.setDiscordSettings({
        allowedUserIds: "987654321098765432",
        botToken: "cached-discord-token",
        profileId: "replacement",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(rejectedRequestCount).toBe(1);
    expect(await loadDiscordConfigFile()).toEqual(beforeReplacement);

    await service.setDiscordSettings({
      allowedUserIds: "987654321098765432",
      profileId: "edited",
    });
    expect(await loadDiscordConfigFile()).toMatchObject({
      allowedUserIds: ["987654321098765432"],
      botToken: "cached-discord-token",
      profileId: "edited",
    });
  });

  test("returns credential-safe HTTP errors without creating channel configs", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const service = new AgentService(null, null, databaseAdapter);
    const { app } = createMinimalHonoApp({ agent: service, databaseAdapter });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () => new Response(null, { status: 401 })
    );

    for (const channel of ["telegram", "discord"] as const) {
      const botToken = `rejected-${channel}-token`;

      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/settings/${channel}`, {
          body: JSON.stringify({ botToken }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "PUT",
        })
      );

      // SAFETY: This test controls the fixture shape at this boundary.
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).not.toContain(botToken);
    }

    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toBeNull();
    expect(await loadDiscordConfigFile()).toBeNull();
  });
});

describe("AgentService WhatsApp allowed phones", () => {
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-wa-allowed-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  });

  async function createWhatsAppService() {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: "well-test-report-validator",
    });

    return new AgentService(null, null, db);
  }

  test("writes allowed phones to WhatsApp config", async () => {
    const service = await createWhatsAppService();

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      allowedPhones: "+62 813-5231-1912",
      profileId: "well-test-report-validator",
    });

    expect(saved.allowedPhones).toEqual(["6281352311912"]);
    expect((await service.getWhatsAppSettings(ORG_ID)).allowedPhones).toEqual([
      "6281352311912",
    ]);
    expect((await loadWhatsAppConfigFile(ORG_ID))?.allowedPhones).toEqual([
      "6281352311912",
    ]);
  });

  test("keeps allowed phones when only the profile is saved", async () => {
    const service = await createWhatsAppService();
    await service.setWhatsAppSettings(ORG_ID, {
      allowedPhones: "6281352311912",
      profileId: "well-test-report-validator",
    });

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      profileId: "well-test-report-validator",
    });

    expect(saved.allowedPhones).toEqual(["6281352311912"]);
    expect((await loadWhatsAppConfigFile(ORG_ID))?.allowedPhones).toEqual([
      "6281352311912",
    ]);
  });

  test("writes requireGroupMention to WhatsApp config", async () => {
    const service = await createWhatsAppService();

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      profileId: "default",
      requireGroupMention: false,
    });

    expect(saved.requireGroupMention).toBe(false);
    expect(
      (await service.getWhatsAppSettings(ORG_ID)).requireGroupMention
    ).toBe(false);
    expect((await loadWhatsAppConfigFile(ORG_ID))?.requireGroupMention).toBe(
      false
    );
  });

  test("writes allowUnpairedGroupMembers to WhatsApp config", async () => {
    const service = await createWhatsAppService();

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      allowUnpairedGroupMembers: true,
      profileId: "default",
    });

    expect(saved.allowUnpairedGroupMembers).toBe(true);
    expect(
      (await service.getWhatsAppSettings(ORG_ID)).allowUnpairedGroupMembers
    ).toBe(true);
    expect(
      (await loadWhatsAppConfigFile(ORG_ID))?.allowUnpairedGroupMembers
    ).toBe(true);
  });
});

async function captureError<T>(run: () => Promise<T>): Promise<Error | null> {
  try {
    await run();

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
