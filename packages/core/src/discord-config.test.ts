import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
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

describe("buildDiscordInviteUrl", () => {
  test("builds an oauth invite link with bot scopes and permissions", () => {
    expect(buildDiscordInviteUrl("1525937133096013954")).toBe(
      "https://discord.com/oauth2/authorize?client_id=1525937133096013954&permissions=68608&scope=bot+applications.commands"
    );
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
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { force: true, recursive: true });
      tempHome = "";
    }
  });

  test("includes an invite URL when Discord returns the application id", async () => {
    tempHome = await mkdtemp(
      path.join(os.tmpdir(), "nakama-core-discord-home-")
    );
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await writeDiscordConfig(tempHome, { botToken: "discord-bot-token" });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "1525937133096013954" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })) as typeof fetch;

    const settings = await loadDiscordSettingsPublic();

    expect(settings.inviteUrl).toBe(
      "https://discord.com/oauth2/authorize?client_id=1525937133096013954&permissions=68608&scope=bot+applications.commands"
    );
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

describe("maskBotToken", () => {
  test("masks long tokens", () => {
    expect(maskBotToken("12345678901234567890")).toBe("••••••••••••7890");
  });

  test("returns null for empty", () => {
    expect(maskBotToken("")).toBeNull();
  });
});

describe("normalizeHandshakeInput", () => {
  test("strips spaces and uppercases", () => {
    expect(normalizeHandshakeInput(" ab cd12 ")).toBe("ABCD12");
  });
});

describe("isDiscordUserAuthorized", () => {
  test("accepts paired or allowlisted users", () => {
    expect(
      isDiscordUserAuthorized("1001", {
        allowedUserIds: [],
        pairedUserIds: ["1001"],
      })
    ).toBe(true);
    expect(
      isDiscordUserAuthorized("1002", {
        allowedUserIds: ["1002"],
        pairedUserIds: [],
      })
    ).toBe(true);
    expect(
      isDiscordUserAuthorized("1003", { allowedUserIds: [], pairedUserIds: [] })
    ).toBe(false);
  });
});

describe("generateHandshakeCode", () => {
  test("returns 8 uppercase hex chars", () => {
    expect(generateHandshakeCode()).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("verifyAndPairDiscordUser", () => {
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

  async function useTempDiscordHome(
    config: Parameters<typeof writeDiscordConfig>[1],
    run: () => Promise<void>
  ): Promise<void> {
    tempHome = await mkdtemp(
      path.join(os.tmpdir(), "nakama-core-discord-home-")
    );
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await writeDiscordConfig(tempHome, config);
    await run();
  }

  test("pairs a user and clears the handshake code", async () => {
    await useTempDiscordHome(
      {
        botToken: "discord-bot-token",
        handshakeCode: "AABBCCDD",
      },
      async () => {
        const result = await verifyAndPairDiscordUser(
          "aa bb cc dd",
          "900100000000000001"
        );

        expect(result).toEqual({
          message: "Linked successfully. You can chat with Nakama now.",
          ok: true,
        });

        const config = await loadDiscordConfigFile();
        expect(config?.pairedUserIds).toEqual(["900100000000000001"]);
        expect(config?.handshakeCode).toBeNull();
      }
    );
  });

  test("rejects invalid pairing codes", async () => {
    await useTempDiscordHome(
      {
        botToken: "discord-bot-token",
        handshakeCode: "AABBCCDD",
      },
      async () => {
        const result = await verifyAndPairDiscordUser(
          "DEADBEEF",
          "900100000000000001"
        );

        expect(result).toEqual({
          message:
            "Invalid pairing code. Copy it from Integrations → Discord and try again.",
          ok: false,
        });

        const config = await loadDiscordConfigFile();
        expect(config?.pairedUserIds).toEqual([]);
        expect(config?.handshakeCode).toBe("AABBCCDD");
      }
    );
  });

  test("rejects pairing when discord is not configured", async () => {
    tempHome = await mkdtemp(
      path.join(os.tmpdir(), "nakama-core-discord-home-")
    );
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

    const result = await verifyAndPairDiscordUser(
      "AABBCCDD",
      "900100000000000001"
    );

    expect(result).toEqual({
      message: "Discord is not configured on the server yet.",
      ok: false,
    });
  });
});

describe("saveDiscordConfig", () => {
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

  async function useTempDiscordHome(run: () => Promise<void>): Promise<void> {
    tempHome = await mkdtemp(
      path.join(os.tmpdir(), "nakama-core-discord-home-")
    );
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await run();
  }

  test("generates a handshake code for a new unrestricted config", async () => {
    await useTempDiscordHome(async () => {
      const result = await saveDiscordConfig({ botToken: "discord-bot-token" });

      expect(result.handshakeCode).toMatch(/^[0-9A-F]{8}$/);

      const saved = await loadDiscordConfigFile();
      expect(saved?.handshakeCode).toBe(result.handshakeCode);
      expect(saved?.allowedUserIds).toEqual([]);
    });
  });
});

describe("resolveDiscordConfigFromSources", () => {
  test("returns null when no bot token is available", () => {
    expect(
      resolveDiscordConfigFromSources({
        env: {},
        file: null,
      })
    ).toBeNull();
  });

  test("prefers env bot token and allowlist over file config", () => {
    const resolved = resolveDiscordConfigFromSources({
      env: {
        DISCORD_ALLOWED_USER_IDS: "123456789012345678, 987654321098765432",
        DISCORD_BOT_TOKEN: "env-token",
      },
      file: {
        allowedUserIds: ["999999999999999999"],
        botToken: "file-token",
        handshakeCode: "ABCD1234",
        pairedUserIds: ["111111111111111111"],
        profileId: "profile_from_file",
      },
    });

    expect(resolved).toEqual({
      allowedUserIds: ["123456789012345678", "987654321098765432"],
      botToken: "env-token",
      handshakeCode: "ABCD1234",
      pairedUserIds: ["111111111111111111"],
      profileId: "profile_from_file",
    });
  });
});

async function writeDiscordConfig(
  homeDir: string,
  config: {
    botToken: string;
    profileId?: string;
    handshakeCode?: string | null;
    pairedUserIds?: string[];
    allowedUserIds?: string[];
  }
): Promise<void> {
  const dir = path.join(homeDir, ".nakama", "discord");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# Nakama Discord bridge",
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId ?? "default"}`,
  ];

  if (config.handshakeCode) {
    lines.push(`handshake_code=${config.handshakeCode}`);
  }

  if (config.pairedUserIds?.length) {
    lines.push(`paired_user_ids=${config.pairedUserIds.join(",")}`);
  }

  if (config.allowedUserIds?.length) {
    lines.push(`allowed_user_ids=${config.allowedUserIds.join(",")}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}
