import { afterEach, describe, expect, test } from "bun:test";
import {
  buildDiscordInviteUrl,
  generateHandshakeCode,
  isDiscordUserAuthorized,
  loadDiscordConfigFile,
  loadDiscordSettingsPublic,
  maskBotToken,
  normalizeHandshakeInput,
  parseAllowedUserIds,
  resolveDiscordApplicationId,
  resolveDiscordConfigFromSources,
  saveDiscordConfig,
  verifyAndPairDiscordUser,
} from "./discord-config";
import {
  describeSharedChannelConfigTests,
  withTempHomedir,
  writeChannelIniConfig,
} from "./testing/channel-config-fixtures";

describe("buildDiscordInviteUrl", () => {
  test("builds an oauth invite link with bot scopes and permissions", () => {
    expect(buildDiscordInviteUrl("1525937133096013954")).toBe(
      "https://discord.com/oauth2/authorize?client_id=1525937133096013954&permissions=101376&scope=bot+applications.commands"
    );
  });

  test("invite permissions bitfield includes Attach Files (32768)", () => {
    const url = new URL(buildDiscordInviteUrl("1525937133096013954"));
    const permissions = Number(url.searchParams.get("permissions"));
    const attachFilesBit = 32_768;
    expect(Math.floor(permissions / attachFilesBit) % 2).toBe(1);
  });
});

describe("resolveDiscordApplicationId", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns the application id from Discord", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "1525937133096013954" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })) as typeof fetch;

    await expect(resolveDiscordApplicationId("test-token")).resolves.toBe(
      "1525937133096013954"
    );
    await expect(resolveDiscordApplicationId("test-token")).resolves.toBe(
      "1525937133096013954"
    );
  });

  test("returns null when Discord rejects the token", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 401 })) as typeof fetch;

    await expect(resolveDiscordApplicationId("bad-token")).resolves.toBeNull();
  });
});

describe("loadDiscordSettingsPublic", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("includes an invite URL when Discord returns the application id", async () => {
    await withTempHomedir("nakama-core-discord-home-", async (tempHome) => {
      await writeChannelIniConfig(tempHome, "discord", {
        botToken: "discord-bot-token",
      });

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ id: "1525937133096013954" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })) as typeof fetch;

      const settings = await loadDiscordSettingsPublic();

      expect(settings.inviteUrl).toBe(
        "https://discord.com/oauth2/authorize?client_id=1525937133096013954&permissions=101376&scope=bot+applications.commands"
      );
    });
  });
});

describe("parseAllowedUserIds", () => {
  test("parses comma-separated snowflake ids", () => {
    expect(
      parseAllowedUserIds("123456789012345678, 987654321098765432")
    ).toEqual(["123456789012345678", "987654321098765432"]);
  });

  test("rejects invalid ids", () => {
    expect(() => parseAllowedUserIds("abc")).toThrow("Invalid Discord user ID");
    expect(() => parseAllowedUserIds("123")).toThrow("Invalid Discord user ID");
  });
});

describeSharedChannelConfigTests({
  allowlistInput: "123456789012345678, 987654321098765432",
  allowlistParsed: ["123456789012345678", "987654321098765432"],
  authorize: {
    allowlisted: "1002",
    paired: "1001",
    unauthorized: "1003",
  },
  botToken: "discord-bot-token",
  env: {
    allowlistKey: "DISCORD_ALLOWED_USER_IDS",
    allowlistParsed: ["123456789012345678", "987654321098765432"],
    allowlistValue: "123456789012345678, 987654321098765432",
    botTokenKey: "DISCORD_BOT_TOKEN",
  },
  generateHandshakeCode,
  isUserAuthorized: isDiscordUserAuthorized,
  label: "Discord",
  loadConfigFile: loadDiscordConfigFile,
  mask: maskBotToken,
  name: "discord",
  normalize: normalizeHandshakeInput,
  resolveConfigFromSources: resolveDiscordConfigFromSources,
  resolveFile: {
    allowedUserIds: ["999999999999999999"],
    pairedUserIds: ["111111111111111111"],
  },
  sampleId: "900100000000000001",
  saveConfig: saveDiscordConfig,
  verifyAndPair: verifyAndPairDiscordUser,
});
