import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeAutomationDelivery,
  shouldDeliverForRun,
  validateAutomationDelivery,
} from "./automation-delivery";
import { getDiscordConfigDir, getDiscordConfigPath } from "./discord-config";

describe("normalizeAutomationDelivery", () => {
  test("returns undefined for missing delivery", () => {
    expect(normalizeAutomationDelivery(undefined)).toBeUndefined();
    expect(normalizeAutomationDelivery(null)).toBeUndefined();
  });

  test("parses telegram delivery", () => {
    expect(normalizeAutomationDelivery({ channel: "telegram" })).toEqual({
      channel: "telegram",
    });
  });

  test("parses discord delivery", () => {
    expect(normalizeAutomationDelivery({ channel: "discord" })).toEqual({
      channel: "discord",
    });
  });

  test("parses discord delivery with channelId", () => {
    expect(
      normalizeAutomationDelivery({
        channel: "discord",
        channelId: "123456789012345678",
      })
    ).toEqual({
      channel: "discord",
      channelId: "123456789012345678",
    });
  });

  test("rejects whitespace-only channelId", () => {
    expect(() =>
      normalizeAutomationDelivery({ channel: "discord", channelId: "   " })
    ).toThrow("delivery.channelId must be a non-empty string.");
  });

  test("rejects channelId that is not a snowflake", () => {
    expect(() =>
      normalizeAutomationDelivery({
        channel: "discord",
        channelId: "1234567890123456",
      })
    ).toThrow("delivery.channelId must be a Discord snowflake.");
    expect(() =>
      normalizeAutomationDelivery({
        channel: "discord",
        channelId: "123456789012345678901",
      })
    ).toThrow("delivery.channelId must be a Discord snowflake.");
  });

  test("rejects discord payload with chatId or to", () => {
    expect(() =>
      normalizeAutomationDelivery({ channel: "discord", chatId: 1 })
    ).toThrow(
      "delivery.chatId is only valid when delivery.channel is telegram."
    );
    expect(() =>
      normalizeAutomationDelivery({
        channel: "discord",
        to: "user@example.com",
      })
    ).toThrow("delivery.to is only valid when delivery.channel is email.");
  });

  test("rejects telegram payload with channelId", () => {
    expect(() =>
      normalizeAutomationDelivery({
        channel: "telegram",
        channelId: "123456789012345678",
      })
    ).toThrow(
      "delivery.channelId is only valid when delivery.channel is discord."
    );
  });

  test("rejects invalid channel", () => {
    expect(() => normalizeAutomationDelivery({ channel: "sms" })).toThrow(
      'delivery.channel must be "telegram", "whatsapp", "email", or "discord".'
    );
  });
});

describe("shouldDeliverForRun", () => {
  test("defaults to success-only delivery", () => {
    expect(shouldDeliverForRun({ channel: "telegram" }, "completed")).toBe(
      true
    );
    expect(shouldDeliverForRun({ channel: "telegram" }, "failed")).toBe(false);
    expect(shouldDeliverForRun({ channel: "discord" }, "completed")).toBe(true);
    expect(shouldDeliverForRun({ channel: "discord" }, "failed")).toBe(false);
  });

  test("honors notifyOn both", () => {
    const delivery = {
      channel: "telegram" as const,
      notifyOn: "both" as const,
    };
    expect(shouldDeliverForRun(delivery, "completed")).toBe(true);
    expect(shouldDeliverForRun(delivery, "failed")).toBe(true);
  });

  test("skips successful runs when notifyOn is failure", () => {
    expect(
      shouldDeliverForRun(
        { channel: "discord", notifyOn: "failure" },
        "completed"
      )
    ).toBe(false);
    expect(
      shouldDeliverForRun({ channel: "discord", notifyOn: "failure" }, "failed")
    ).toBe(true);
  });
});

describe("validateAutomationDelivery", () => {
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }
  });

  test("no-ops when delivery is omitted", async () => {
    await expect(
      validateAutomationDelivery(undefined)
    ).resolves.toBeUndefined();
  });

  test("rejects discord without a bot token", async () => {
    process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
      join(tmpdir(), "nakama-discord-delivery-")
    );

    await expect(
      validateAutomationDelivery({ channel: "discord" })
    ).rejects.toThrow(
      "Discord is not configured. Set up Integrations → Discord first."
    );

    await rm(process.env.NAKAMA_CONFIG_DIR, { force: true, recursive: true });
  });

  test("rejects discord without pairing when channelId is omitted", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-discord-delivery-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(getDiscordConfigDir(), { recursive: true });
    await writeFile(getDiscordConfigPath(), "bot_token=test-token\n", "utf8");

    await expect(
      validateAutomationDelivery({ channel: "discord" })
    ).rejects.toThrow(
      "Discord is not paired. Link your account in Integrations → Discord first."
    );

    await rm(configDir, { force: true, recursive: true });
  });

  test("accepts discord with token and pairing", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-discord-delivery-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(getDiscordConfigDir(), { recursive: true });
    await writeFile(
      getDiscordConfigPath(),
      "bot_token=test-token\npaired_user_ids=123456789012345678\n",
      "utf8"
    );

    await expect(
      validateAutomationDelivery({ channel: "discord" })
    ).resolves.toBeUndefined();

    await rm(configDir, { force: true, recursive: true });
  });

  test("accepts discord with token and channelId without pairing", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-discord-delivery-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(getDiscordConfigDir(), { recursive: true });
    await writeFile(getDiscordConfigPath(), "bot_token=test-token\n", "utf8");

    await expect(
      validateAutomationDelivery({
        channel: "discord",
        channelId: "123456789012345678",
      })
    ).resolves.toBeUndefined();

    await rm(configDir, { force: true, recursive: true });
  });
});
