import { randomBytes } from "node:crypto";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";
import { maskTrailingSecret } from "./secret-mask";

export function maskBotToken(secret: string): string | null {
  return maskTrailingSecret(secret);
}

export function generateHandshakeCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function normalizeHandshakeInput(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

export type BotChannelConfigFile<TId extends string | number> = {
  allowedUserIds: TId[];
  botToken: string;
  handshakeCode: string | null;
  pairedUserIds: TId[];
  profileId: string;
};

export type ChannelPairResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export function isBotChannelUserAuthorized<TId extends string | number>(
  userId: TId,
  config: Pick<BotChannelConfigFile<TId>, "pairedUserIds" | "allowedUserIds">
): boolean {
  return (
    config.pairedUserIds.includes(userId) ||
    config.allowedUserIds.includes(userId)
  );
}

export function resolveHandshakeCodeOnSave<TId extends string | number>(
  existing: Pick<
    BotChannelConfigFile<TId>,
    "pairedUserIds" | "handshakeCode"
  > | null,
  allowedUserIds: TId[]
): string | null {
  const pairedUserIds = existing?.pairedUserIds ?? [];
  const handshakeCode = existing?.handshakeCode ?? null;

  if (pairedUserIds.length > 0 || allowedUserIds.length > 0 || handshakeCode) {
    return handshakeCode;
  }

  return generateHandshakeCode();
}

export async function loadBotChannelIniConfig<
  TId extends string | number,
>(options: {
  configPath: string;
  defaultProfileId: string;
  parseUserIds: (raw: string) => TId[];
}): Promise<BotChannelConfigFile<TId> | null> {
  const raw = await readTextOrNull(options.configPath);

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);
  const botToken = values.bot_token?.trim() ?? "";
  const profileId = values.profile_id?.trim() || options.defaultProfileId;
  const handshakeCode = values.handshake_code?.trim() || null;
  const pairedRaw = values.paired_user_ids?.trim() ?? "";
  const allowlistRaw = values.allowed_user_ids?.trim() ?? "";

  if (!botToken) {
    return null;
  }

  return {
    allowedUserIds: allowlistRaw ? options.parseUserIds(allowlistRaw) : [],
    botToken,
    handshakeCode,
    pairedUserIds: pairedRaw ? options.parseUserIds(pairedRaw) : [],
    profileId,
  };
}

export async function writeBotChannelIniConfig<
  TId extends string | number,
>(options: {
  config: BotChannelConfigFile<TId>;
  configDir: string;
  configPath: string;
  label: string;
}): Promise<void> {
  const { config } = options;
  const lines = [
    `# Nakama ${options.label} bridge`,
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId}`,
    ...(config.handshakeCode ? [`handshake_code=${config.handshakeCode}`] : []),
    ...(config.pairedUserIds.length > 0
      ? [`paired_user_ids=${config.pairedUserIds.join(",")}`]
      : []),
    ...(config.allowedUserIds.length > 0
      ? [`allowed_user_ids=${config.allowedUserIds.join(",")}`]
      : []),
    "",
  ];

  await writeTextFile(options.configPath, lines.join("\n"), {
    ensureDir: options.configDir,
  });
}

export async function verifyAndPairBotChannelUser<
  TId extends string | number,
>(options: {
  handshakeInput: string;
  isAuthorized: (
    userId: TId,
    config: Pick<BotChannelConfigFile<TId>, "pairedUserIds" | "allowedUserIds">
  ) => boolean;
  label: string;
  load: () => Promise<BotChannelConfigFile<TId> | null>;
  userId: TId;
  write: (config: BotChannelConfigFile<TId>) => Promise<void>;
}): Promise<ChannelPairResult> {
  const config = await options.load();

  if (!config) {
    return {
      message: `${options.label} is not configured on the server yet.`,
      ok: false,
    };
  }

  if (options.isAuthorized(options.userId, config)) {
    return { message: "This chat is already linked.", ok: true };
  }

  const expected = config.handshakeCode;

  if (!expected) {
    return {
      message: `No pairing code is active. Open Nakama Integrations → ${options.label} and generate a new code.`,
      ok: false,
    };
  }

  if (
    normalizeHandshakeInput(options.handshakeInput) !==
    normalizeHandshakeInput(expected)
  ) {
    return {
      message: `Invalid pairing code. Copy it from Integrations → ${options.label} and try again.`,
      ok: false,
    };
  }

  const pairedUserIds = [...new Set([...config.pairedUserIds, options.userId])];

  await options.write({
    ...config,
    handshakeCode: null,
    pairedUserIds,
  });

  return {
    message: "Linked successfully. You can chat with Nakama now.",
    ok: true,
  };
}
