import { describe, expect, test } from "bun:test";
import { describeSharedChannelConfigTests } from "./testing/channel-config-fixtures";
import {
  generateHandshakeCode,
  isTelegramUserAuthorized,
  loadTelegramConfigFile,
  maskBotToken,
  normalizeHandshakeInput,
  parseAllowedUserIds,
  resolveTelegramConfigFromSources,
  saveTelegramConfig,
  verifyAndPairTelegramUser,
} from "./telegram-config";

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
  label: "Telegram",
  loadConfigFile: loadTelegramConfigFile,
  mask: maskBotToken,
  name: "telegram",
  normalize: normalizeHandshakeInput,
  resolveConfigFromSources: resolveTelegramConfigFromSources,
  resolveFile: {
    allowedUserIds: [99],
    pairedUserIds: [1],
  },
  sampleId: 9001,
  saveConfig: saveTelegramConfig,
  verifyAndPair: verifyAndPairTelegramUser,
});
