import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

export const HANDSHAKE_CODE_PATTERN = /^[0-9A-F]{8}$/;

export const MASK_BOT_TOKEN_CASES = [
  {
    expected: "••••••••••••7890",
    input: "12345678901234567890",
    name: "masks long tokens",
  },
  {
    expected: null,
    input: "",
    name: "returns null for empty",
  },
] as const;

export const NORMALIZE_HANDSHAKE_INPUT_CASES = [
  {
    expected: "ABCD12",
    input: " ab cd12 ",
    name: "strips spaces and uppercases",
  },
] as const;

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
  profileId?: string;
  handshakeCode?: string | null;
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

  if (config.pairedUserIds?.length) {
    lines.push(`paired_user_ids=${config.pairedUserIds.join(",")}`);
  }

  if (config.allowedUserIds?.length) {
    lines.push(`allowed_user_ids=${config.allowedUserIds.join(",")}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}

export type SharedChannelConfigCase<TId extends string | number> = {
  name: "telegram" | "discord";
  label: string;
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
  generateHandshakeCode: () => string;
  isUserAuthorized: (
    userId: TId,
    access: { allowedUserIds: TId[]; pairedUserIds: TId[] }
  ) => boolean;
  verifyAndPair: (
    code: string,
    userId: TId
  ) => Promise<{ ok: boolean; message: string }>;
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
      for (const c of MASK_BOT_TOKEN_CASES) {
        test(c.name, () => {
          expect(tc.mask(c.input)).toBe(c.expected);
        });
      }
    });

    describe("normalizeHandshakeInput", () => {
      for (const c of NORMALIZE_HANDSHAKE_INPUT_CASES) {
        test(c.name, () => {
          expect(tc.normalize(c.input)).toBe(c.expected);
        });
      }
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

    describe("generateHandshakeCode", () => {
      test("returns 8 uppercase hex chars", () => {
        expect(tc.generateHandshakeCode()).toMatch(HANDSHAKE_CODE_PATTERN);
      });
    });

    describe("verifyAndPair", () => {
      test("pairs a user and clears the handshake code", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            handshakeCode: "AABBCCDD",
          });

          const result = await tc.verifyAndPair("aa bb cc dd", tc.sampleId);

          expect(result).toEqual({
            message: "Linked successfully. You can chat with Nakama now.",
            ok: true,
          });

          const config = await tc.loadConfigFile();
          expect(config?.pairedUserIds).toEqual([tc.sampleId]);
          expect(config?.handshakeCode).toBeNull();
        });
      });

      test("rejects invalid pairing codes", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            handshakeCode: "AABBCCDD",
          });

          const result = await tc.verifyAndPair("DEADBEEF", tc.sampleId);

          expect(result).toEqual({
            message: `Invalid pairing code. Copy it from Integrations → ${tc.label} and try again.`,
            ok: false,
          });

          const config = await tc.loadConfigFile();
          expect(config?.pairedUserIds).toEqual([]);
          expect(config?.handshakeCode).toBe("AABBCCDD");
        });
      });

      test("rejects pairing when channel is not configured", async () => {
        await withTempHomedir(tempPrefix, async () => {
          const result = await tc.verifyAndPair("AABBCCDD", tc.sampleId);

          expect(result).toEqual({
            message: `${tc.label} is not configured on the server yet.`,
            ok: false,
          });
        });
      });

      test("returns already linked for paired users", async () => {
        await withTempHomedir(tempPrefix, async (homeDir) => {
          await writeChannelIniConfig(homeDir, tc.name, {
            botToken: tc.botToken,
            pairedUserIds: [tc.sampleId],
          });

          const result = await tc.verifyAndPair("anything", tc.sampleId);

          expect(result).toEqual({
            message: "This chat is already linked.",
            ok: true,
          });
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
            pairedUserIds: tc.resolveFile.pairedUserIds,
            profileId: "profile_from_file",
          },
        });

        expect(resolved).toEqual({
          allowedUserIds: tc.env.allowlistParsed,
          botToken: "env-token",
          handshakeCode: "ABCD1234",
          pairedUserIds: tc.resolveFile.pairedUserIds,
          profileId: "profile_from_file",
        });
      });

      test("falls back to file config when env token is absent", () => {
        const resolved = tc.resolveConfigFromSources({
          env: {},
          file: {
            allowedUserIds: tc.allowlistParsed,
            botToken: "file-token",
            handshakeCode: null,
            pairedUserIds: [],
            profileId: "profile_from_file",
          },
        });

        expect(resolved?.botToken).toBe("file-token");
        expect(resolved?.allowedUserIds).toEqual(tc.allowlistParsed);
      });
    });
  });
}
