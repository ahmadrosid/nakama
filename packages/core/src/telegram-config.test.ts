import { describe, expect, test } from "bun:test";
import {
  claimLegacyTelegramConfig,
  generateHandshakeCode,
  getTelegramConfigDir,
  isTelegramUserAuthorized,
  listTelegramConfigOrgIds,
  loadTelegramConfigFile,
  maskBotToken,
  normalizeHandshakeInput,
  parseAllowedUserIds,
  resolveTelegramConfigFromSources,
  saveTelegramConfig,
  verifyAndPairTelegramUser,
} from "./telegram-config";
import {
  describeSharedChannelConfigTests,
  withTempHomedir,
} from "./testing/channel-config-fixtures";

describe("parseAllowedUserIds", () => {
  test("parses comma-separated ids", () => {
    expect(parseAllowedUserIds("123, 456")).toEqual([123, 456]);
  });

  test("rejects invalid ids", () => {
    expect(() => parseAllowedUserIds("abc")).toThrow(
      "Invalid Telegram user ID"
    );
    expect(() => parseAllowedUserIds("0")).toThrow("Invalid Telegram user ID");
    expect(() => parseAllowedUserIds("-5")).toThrow("Invalid Telegram user ID");
  });
});

describeSharedChannelConfigTests({
  allowlistInput: "42, 43",
  allowlistParsed: [42, 43],
  authorize: {
    allowlisted: 2,
    paired: 1,
    unauthorized: 3,
  },
  botToken: "1234567890:TEST",
  env: {
    allowlistKey: "TELEGRAM_ALLOWED_USER_IDS",
    allowlistParsed: [42, 43],
    allowlistValue: "42, 43",
    botTokenKey: "TELEGRAM_BOT_TOKEN",
  },
  generateHandshakeCode,
  isUserAuthorized: isTelegramUserAuthorized,
  loadConfigFile: () => loadTelegramConfigFile(null),
  mask: maskBotToken,
  name: "telegram",
  normalize: normalizeHandshakeInput,
  resolveConfigFromSources: resolveTelegramConfigFromSources,
  resolveFile: {
    allowedUserIds: [99],
    pairedUserIds: [1],
  },
  sampleId: 9001,
  saveConfig: (input) => saveTelegramConfig(null, input),
  verifyAndPair: (handshakeInput, userId) =>
    verifyAndPairTelegramUser(null, handshakeInput, userId),
});

describe("per-org telegram config", () => {
  test("keeps each org's credentials out of the other scopes", async () => {
    await withTempHomedir("nakama-telegram-org-", async () => {
      await saveTelegramConfig("org_a", { botToken: "111:AAA" });

      expect(await loadTelegramConfigFile("org_b")).toBeNull();
      expect(await loadTelegramConfigFile(null)).toBeNull();
      expect((await loadTelegramConfigFile("org_a"))?.botToken).toBe("111:AAA");
      expect(await listTelegramConfigOrgIds()).toEqual(["org_a"]);
    });
  });

  test("refuses a bot token another scope already runs", async () => {
    await withTempHomedir("nakama-telegram-dup-", async () => {
      await saveTelegramConfig(null, { botToken: "111:AAA" });

      await expect(
        saveTelegramConfig("org_b", { botToken: "111:AAA" })
      ).rejects.toThrow("already in use by another organization");
    });
  });

  test("claims the install-wide config for a sole org, once", async () => {
    await withTempHomedir("nakama-telegram-claim-", async () => {
      await saveTelegramConfig(null, { botToken: "111:AAA" });

      expect(await claimLegacyTelegramConfig("org_a")).toBe(true);
      expect((await loadTelegramConfigFile("org_a"))?.botToken).toBe("111:AAA");
      expect(await loadTelegramConfigFile(null)).toBeNull();
      expect(await claimLegacyTelegramConfig("org_a")).toBe(false);
    });
  });

  test("rejects an org id that would escape the config dir", () => {
    expect(() => getTelegramConfigDir("../../etc")).toThrow(
      "Invalid organization id"
    );
  });
});
