import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  generateHandshakeCode,
  isDiscordUserAuthorized,
  loadDiscordConfigFile,
  maskBotToken,
  normalizeHandshakeInput,
  parseAllowedUserIds,
  resolveDiscordConfigFromSources,
  saveDiscordConfig,
  verifyAndPairDiscordUser,
} from "./discord-config";

describe("parseAllowedUserIds", () => {
  test("parses comma-separated snowflake ids", () => {
    expect(parseAllowedUserIds("123456789012345678, 987654321098765432")).toEqual([
      "123456789012345678",
      "987654321098765432",
    ]);
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
      isDiscordUserAuthorized("1001", { pairedUserIds: ["1001"], allowedUserIds: [] }),
    ).toBe(true);
    expect(
      isDiscordUserAuthorized("1002", { pairedUserIds: [], allowedUserIds: ["1002"] }),
    ).toBe(true);
    expect(
      isDiscordUserAuthorized("1003", { pairedUserIds: [], allowedUserIds: [] }),
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
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  async function useTempDiscordHome(
    config: Parameters<typeof writeDiscordConfig>[1],
    run: () => Promise<void>,
  ): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-discord-home-"));
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
        const result = await verifyAndPairDiscordUser("aa bb cc dd", "900100000000000001");

        expect(result).toEqual({
          ok: true,
          message: "Linked successfully. You can chat with Nakama now.",
        });

        const config = await loadDiscordConfigFile();
        expect(config?.pairedUserIds).toEqual(["900100000000000001"]);
        expect(config?.handshakeCode).toBeNull();
      },
    );
  });

  test("rejects invalid pairing codes", async () => {
    await useTempDiscordHome(
      {
        botToken: "discord-bot-token",
        handshakeCode: "AABBCCDD",
      },
      async () => {
        const result = await verifyAndPairDiscordUser("DEADBEEF", "900100000000000001");

        expect(result).toEqual({
          ok: false,
          message: "Invalid pairing code. Copy it from Integrations → Discord and try again.",
        });

        const config = await loadDiscordConfigFile();
        expect(config?.pairedUserIds).toEqual([]);
        expect(config?.handshakeCode).toBe("AABBCCDD");
      },
    );
  });

  test("rejects pairing when discord is not configured", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-discord-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

    const result = await verifyAndPairDiscordUser("AABBCCDD", "900100000000000001");

    expect(result).toEqual({
      ok: false,
      message: "Discord is not configured on the server yet.",
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
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  async function useTempDiscordHome(run: () => Promise<void>): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-discord-home-"));
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
      }),
    ).toBeNull();
  });

  test("prefers env bot token and allowlist over file config", () => {
    const resolved = resolveDiscordConfigFromSources({
      env: {
        DISCORD_BOT_TOKEN: "env-token",
        DISCORD_ALLOWED_USER_IDS: "123456789012345678, 987654321098765432",
      },
      file: {
        botToken: "file-token",
        profileId: "profile_from_file",
        handshakeCode: "ABCD1234",
        pairedUserIds: ["111111111111111111"],
        allowedUserIds: ["999999999999999999"],
      },
    });

    expect(resolved).toEqual({
      botToken: "env-token",
      profileId: "profile_from_file",
      handshakeCode: "ABCD1234",
      pairedUserIds: ["111111111111111111"],
      allowedUserIds: ["123456789012345678", "987654321098765432"],
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
  },
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
