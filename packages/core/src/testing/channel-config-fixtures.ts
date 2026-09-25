import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

export const HANDSHAKE_CODE_PATTERN = /^[0-9A-F]{32}$/;

/** A code that is still live when the bridge reads it back. */
export function liveHandshakeCode(code = "A".repeat(32)): {
  handshakeCode: string;
  handshakeExpiresAt: string;
} {
  return {
    handshakeCode: code,
    handshakeExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

export async function withTempHomedir(
  prefix: string,
  run: (homeDir: string) => Promise<void>
): Promise<void> {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), prefix));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

  try {
    await run(tempHome);
  } finally {
    homedirSpy.mockRestore();
    await rm(tempHome, { force: true, recursive: true });
  }
}

export type ChannelIniConfig = {
  botToken: string;
  handshakeCode?: string | null;
  handshakeExpiresAt?: string | null;
  pairedUserIds?: Array<string | number>;
  allowedUserIds?: Array<string | number>;
};

export async function writeChannelIniConfig(
  homeDir: string,
  channel: "telegram" | "discord",
  config: ChannelIniConfig
): Promise<void> {
  const dir = path.join(homeDir, ".nakama", channel);
  await mkdir(dir, { recursive: true });

  const label = channel === "telegram" ? "Telegram" : "Discord";
  const lines = [
    `# Nakama ${label} bridge`,
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId ?? "default"}`,
  ];

  if (config.handshakeCode) {
    lines.push(`handshake_code=${config.handshakeCode}`);
  }

  if (config.handshakeExpiresAt) {
    lines.push(`handshake_expires_at=${config.handshakeExpiresAt}`);
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

type SharedChannelConfigCase<TId extends string | number> = {
  name: "telegram" | "discord";
  botToken: string;
  sampleId: TId;
  authorize: {
    paired: TId;
    allowlisted: TId;
    unauthorized: TId;
  };
  allowlistInput: string;
  allowlistParsed: TId[];
  env: {
    botTokenKey: string;
    allowlistKey: string;
    allowlistValue: string;
    allowlistParsed: TId[];
  };
  resolveFile: {
    allowedUserIds: TId[];
    pairedUserIds: TId[];
  };
  mask: (token: string) => string | null;
  normalize: (input: string) => string;
  generatePairingCode: () => string;
  isUserAuthorized: (
    userId: TId,
    access: { allowedUserIds: TId[]; pairedUserIds: TId[] }
  ) => boolean;
  verifyAndPair: (code: string, userId: TId) => Promise<{ ok: boolean }>;
  regenerate: () => Promise<{ handshakeCode: string | null }>;
  saveConfig: (input: {
    botToken: string;
    allowedUserIds?: string;
  }) => Promise<{ handshakeCode: string | null }>;
  loadConfigFile: () => Promise<{
    handshakeCode: string | null;
    pairedUserIds: TId[];
    allowedUserIds: TId[];
  } | null>;
  resolveConfigFromSources: (sources: {
    env: Record<string, string | undefined>;
    file: {
      allowedUserIds: TId[];
      botToken: string;
      handshakeCode: string | null;
      pairedUserIds: TId[];
      profileId: string;
    } | null;
  }) => {
    allowedUserIds: TId[];
    botToken: string;
    handshakeCode: string | null;
    pairedUserIds: TId[];
    profileId: string;
  } | null;
};

export function describeSharedChannelConfigTests<TId extends string | number>(
  tc: SharedChannelConfigCase<TId>
): void {
  const tempPrefix = `nakama-core-${tc.name}-home-`;

  describe(`${tc.name} shared channel config`, () => {
    describe("maskBotToken", () => {
      test("masks long tokens and returns null for empty", () => {
        expect(tc.mask("12345678901234567890")).toBe("••••••••••••7890");
        expect(tc.mask("")).toBeNull();
      });
    });

    describe("normalizePairingCode", () => {
      test("strips spaces and grouping, and uppercases", () => {
        expect(tc.normalize(" ab-cd 12 ")).toBe("ABCD12");
      });
    });

    describe("isUserAuthorized", () => {
      test("accepts paired or allowlisted users", () => {
        expect(
          tc.isUserAuthorized(tc.authorize.paired, {
            allowedUserIds: [],
            pairedUserIds: [tc.authorize.paired],
          })
        ).toBe(true);
        expect(
          tc.isUserAuthorized(tc.authorize.allowlisted, {
            allowedUserIds: [tc.authorize.allowlisted],
            pairedUserIds: [],
          })
        ).toBe(true);
        expect(
          tc.isUserAuthorized(tc.authorize.unauthorized, {
            allowedUserIds: [],
            pairedUserIds: [],
          })
        ).toBe(false);
      });
    });

    describe("generatePairingCode", () => {
      test("returns 32 uppercase hex chars", () => {
        expect(tc.generatePairingCode()).toMatch(HANDSHAKE_CODE_PATTERN);
      });
    });

    describe("verifyAndPair", () => {
      test("pairs a user and consumes the code", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          const code = liveHandshakeCode("A1B2C3D4E5F60718293A4B5C6D7E8F90");
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            ...code,
          });

          const result = await tc.verifyAndPair(
            code.handshakeCode.toLowerCase(),
            tc.sampleId
          );

          expect(result.ok).toBe(true);

          const config = await tc.loadConfigFile();
          expect(config?.pairedUserIds).toEqual([tc.sampleId]);
          expect(config?.handshakeCode).toBeNull();
        });
      });

      test("rejects a code whose expiry has passed", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            handshakeCode: liveHandshakeCode().handshakeCode,
            handshakeExpiresAt: new Date(Date.now() - 1000).toISOString(),
          });

          const result = await tc.verifyAndPair(
            liveHandshakeCode().handshakeCode,
            tc.sampleId
          );

          expect(result.ok).toBe(false);

          const config = await tc.loadConfigFile();
          expect(config?.pairedUserIds).toEqual([]);
        });
      });

      test("gives an expired code the same answer as a wrong one", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            ...liveHandshakeCode(),
          });
          const wrong = await tc.verifyAndPair(
            liveHandshakeCode("B".repeat(32)).handshakeCode,
            tc.sampleId
          );

          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            handshakeCode: liveHandshakeCode("C".repeat(32)).handshakeCode,
            handshakeExpiresAt: new Date(Date.now() - 1000).toISOString(),
          });
          const expired = await tc.verifyAndPair(
            liveHandshakeCode("C".repeat(32)).handshakeCode,
            tc.authorize.unauthorized
          );

          expect(expired).toEqual(wrong);
        });
      });

      test("rejects invalid pairing codes and keeps the code", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          const code = liveHandshakeCode();
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            ...code,
          });

          const result = await tc.verifyAndPair("F".repeat(32), tc.sampleId);

          expect(result.ok).toBe(false);

          const config = await tc.loadConfigFile();
          expect(config?.pairedUserIds).toEqual([]);
          expect(config?.handshakeCode).toBe(code.handshakeCode);
        });
      });

      test("retires the code once the per-code attempt budget is spent", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          const code = liveHandshakeCode();
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            ...code,
          });

          for (let attempt = 0; attempt < 4; attempt += 1) {
            expect(
              (await tc.verifyAndPair("F".repeat(32), tc.sampleId)).ok
            ).toBe(false);
          }
          expect((await tc.loadConfigFile())?.handshakeCode).toBe(
            code.handshakeCode
          );

          expect((await tc.verifyAndPair("F".repeat(32), tc.sampleId)).ok).toBe(
            false
          );

          expect((await tc.loadConfigFile())?.handshakeCode).toBeNull();
        });
      });

      test("pairs with a regenerated code after the budget was spent", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            ...liveHandshakeCode(),
          });
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await tc.verifyAndPair("F".repeat(32), tc.sampleId);
          }

          const fresh = await tc.regenerate();
          const result = await tc.verifyAndPair(
            fresh.handshakeCode as string,
            tc.sampleId
          );

          expect(result.ok).toBe(true);
        });
      });

      test("rejects pairing when channel is not configured", async () => {
        await withTempHomedir(tempPrefix, async () => {
          const result = await tc.verifyAndPair("A".repeat(32), tc.sampleId);

          expect(result.ok).toBe(false);
        });
      });

      test("returns already linked for paired users", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            pairedUserIds: [tc.sampleId],
          });

          const result = await tc.verifyAndPair("anything", tc.sampleId);

          expect(result.ok).toBe(true);
        });
      });
    });

    describe("saveConfig", () => {
      test("generates a handshake code for a new unrestricted config", async () => {
        await withTempHomedir(tempPrefix, async () => {
          const result = await tc.saveConfig({ botToken: tc.botToken });

          expect(result.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);

          const saved = await tc.loadConfigFile();
          expect(saved?.handshakeCode).toBe(result.handshakeCode);
          expect(saved?.allowedUserIds).toEqual([]);
        });
      });

      test("does not generate a handshake code when allowlist is set", async () => {
        await withTempHomedir(tempPrefix, async () => {
          const result = await tc.saveConfig({
            allowedUserIds: tc.allowlistInput,
            botToken: tc.botToken,
          });

          expect(result.handshakeCode).toBeNull();

          const saved = await tc.loadConfigFile();
          expect(saved?.allowedUserIds).toEqual(tc.allowlistParsed);
          expect(saved?.handshakeCode).toBeNull();
        });
      });
    });

    describe("resolveConfigFromSources", () => {
      test("returns null when no bot token is available", () => {
        expect(
          tc.resolveConfigFromSources({
            env: {},
            file: null,
          })
        ).toBeNull();
      });

      test("prefers env bot token and allowlist over file config", () => {
        const resolved = tc.resolveConfigFromSources({
          env: {
            [tc.env.allowlistKey]: tc.env.allowlistValue,
            [tc.env.botTokenKey]: "env-token",
          },
          file: {
            allowedUserIds: tc.resolveFile.allowedUserIds,
            botToken: "file-token",
            handshakeCode: "ABCD1234",
            handshakeExpiresAt: "2099-01-01T00:00:00.000Z",
            pairedUserIds: tc.resolveFile.pairedUserIds,
            profileId: "profile_from_file",
          },
        });

        expect(resolved).toEqual({
          allowedUserIds: tc.env.allowlistParsed,
          botToken: "env-token",
          handshakeCode: "ABCD1234",
          handshakeExpiresAt: "2099-01-01T00:00:00.000Z",
          pairedUserIds: tc.resolveFile.pairedUserIds,
          profileId: "profile_from_file",
        });
      });

      test("reads a bot token from a mounted secret file", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          const secretPath = path.join(homeDir, "bot-token");
          await writeFile(secretPath, "mounted-token\n", "utf8");

          const resolved = tc.resolveConfigFromSources({
            env: { [`${tc.env.botTokenKey}_FILE`]: secretPath },
            file: null,
          });

          expect(resolved?.botToken).toBe("mounted-token");
        });
      });

      test("prefers a direct bot token over its mounted-file companion", () => {
        const resolved = tc.resolveConfigFromSources({
          env: {
            [tc.env.botTokenKey]: "direct-token",
            [`${tc.env.botTokenKey}_FILE`]: "/missing/secret",
          },
          file: null,
        });

        expect(resolved?.botToken).toBe("direct-token");
      });

      test("falls back to file config when env token is absent", () => {
        const resolved = tc.resolveConfigFromSources({
          env: {},
          file: {
            allowedUserIds: tc.allowlistParsed,
            botToken: "file-token",
            handshakeCode: null,
            handshakeExpiresAt: null,
            profileId: "profile_from_file",
          },
        });

        expect(resolved?.botToken).toBe("file-token");
        expect(resolved?.allowedUserIds).toEqual(tc.allowlistParsed);
      });
    });
  });
}
