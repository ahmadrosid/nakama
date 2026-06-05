import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
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
    expect(() => parseAllowedUserIds("abc")).toThrow("Invalid Telegram user ID");
    expect(() => parseAllowedUserIds("0")).toThrow("Invalid Telegram user ID");
    expect(() => parseAllowedUserIds("-5")).toThrow("Invalid Telegram user ID");
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

describe("isTelegramUserAuthorized", () => {
  test("accepts paired or allowlisted users", () => {
    expect(
      isTelegramUserAuthorized(1, { pairedUserIds: [1], allowedUserIds: [] }),
    ).toBe(true);
    expect(
      isTelegramUserAuthorized(2, { pairedUserIds: [], allowedUserIds: [2] }),
    ).toBe(true);
    expect(
      isTelegramUserAuthorized(3, { pairedUserIds: [], allowedUserIds: [] }),
    ).toBe(false);
  });
});

describe("generateHandshakeCode", () => {
  test("returns 8 uppercase hex chars", () => {
    expect(generateHandshakeCode()).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("verifyAndPairTelegramUser", () => {
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

  async function useTempTelegramHome(
    config: Parameters<typeof writeTelegramConfig>[1],
    run: () => Promise<void>,
  ): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-core-tg-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await writeTelegramConfig(tempHome, config);
    await run();
  }

  test("pairs a user and clears the handshake code", async () => {
    await useTempTelegramHome(
      {
        botToken: "1234567890:TEST",
        handshakeCode: "AABBCCDD",
      },
      async () => {
        const result = await verifyAndPairTelegramUser("aa bb cc dd", 9001);

        expect(result).toEqual({
          ok: true,
          message: "Linked successfully. You can chat with TinyClaw now.",
        });

        const config = await loadTelegramConfigFile();
        expect(config?.pairedUserIds).toEqual([9001]);
        expect(config?.handshakeCode).toBeNull();
      },
    );
  });

  test("rejects invalid pairing codes", async () => {
    await useTempTelegramHome(
      {
        botToken: "1234567890:TEST",
        handshakeCode: "AABBCCDD",
      },
      async () => {
        const result = await verifyAndPairTelegramUser("DEADBEEF", 9001);

        expect(result).toEqual({
          ok: false,
          message: "Invalid pairing code. Copy it from Settings → Telegram and try again.",
        });

        const config = await loadTelegramConfigFile();
        expect(config?.pairedUserIds).toEqual([]);
        expect(config?.handshakeCode).toBe("AABBCCDD");
      },
    );
  });

  test("rejects pairing when telegram is not configured", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-core-tg-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

    const result = await verifyAndPairTelegramUser("AABBCCDD", 9001);

    expect(result).toEqual({
      ok: false,
      message: "Telegram is not configured on the server yet.",
    });
  });

  test("returns already linked for paired users", async () => {
    await useTempTelegramHome(
      {
        botToken: "1234567890:TEST",
        pairedUserIds: [9001],
      },
      async () => {
        const result = await verifyAndPairTelegramUser("anything", 9001);

        expect(result).toEqual({
          ok: true,
          message: "This chat is already linked.",
        });
      },
    );
  });
});

describe("saveTelegramConfig", () => {
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

  async function useTempTelegramHome(run: () => Promise<void>): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-core-tg-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await run();
  }

  test("generates a handshake code for a new unrestricted config", async () => {
    await useTempTelegramHome(async () => {
      const result = await saveTelegramConfig({ botToken: "1234567890:TEST" });

      expect(result.handshakeCode).toMatch(/^[0-9A-F]{8}$/);

      const saved = await loadTelegramConfigFile();
      expect(saved?.handshakeCode).toBe(result.handshakeCode);
      expect(saved?.allowedUserIds).toEqual([]);
    });
  });

  test("does not generate a handshake code when allowlist is set", async () => {
    await useTempTelegramHome(async () => {
      const result = await saveTelegramConfig({
        botToken: "1234567890:TEST",
        allowedUserIds: "42, 43",
      });

      expect(result.handshakeCode).toBeNull();

      const saved = await loadTelegramConfigFile();
      expect(saved?.allowedUserIds).toEqual([42, 43]);
      expect(saved?.handshakeCode).toBeNull();
    });
  });
});

describe("resolveTelegramConfigFromSources", () => {
  test("returns null when no bot token is available", () => {
    expect(
      resolveTelegramConfigFromSources({
        env: {},
        file: null,
      }),
    ).toBeNull();
  });

  test("prefers env bot token and allowlist over file config", () => {
    const resolved = resolveTelegramConfigFromSources({
      env: {
        TELEGRAM_BOT_TOKEN: "env-token",
        TELEGRAM_ALLOWED_USER_IDS: "42, 43",
      },
      file: {
        botToken: "file-token",
        profileId: "profile_from_file",
        handshakeCode: "ABCD1234",
        pairedUserIds: [1],
        allowedUserIds: [99],
      },
    });

    expect(resolved).toEqual({
      botToken: "env-token",
      profileId: "profile_from_file",
      handshakeCode: "ABCD1234",
      pairedUserIds: [1],
      allowedUserIds: [42, 43],
    });
  });

  test("falls back to file config when env token is absent", () => {
    const resolved = resolveTelegramConfigFromSources({
      env: {},
      file: {
        botToken: "file-token",
        profileId: "profile_from_file",
        handshakeCode: null,
        pairedUserIds: [],
        allowedUserIds: [7],
      },
    });

    expect(resolved?.botToken).toBe("file-token");
    expect(resolved?.allowedUserIds).toEqual([7]);
  });
});

async function writeTelegramConfig(
  homeDir: string,
  config: {
    botToken: string;
    profileId?: string;
    handshakeCode?: string | null;
    pairedUserIds?: number[];
    allowedUserIds?: number[];
  },
): Promise<void> {
  const dir = path.join(homeDir, ".tinyclaw", "telegram");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# TinyClaw Telegram bridge",
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId ?? "profile_default"}`,
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
