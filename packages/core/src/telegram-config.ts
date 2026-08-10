import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { parseIni, readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

export const DEFAULT_TELEGRAM_PROFILE_ID = "default";

export interface TelegramConfigFile {
  allowedUserIds: number[];
  botToken: string;
  handshakeCode: string | null;
  pairedUserIds: number[];
  profileId: string;
}

export interface TelegramSettingsPublic {
  allowedUserIds: number[];
  botTokenMasked: string | null;
  configured: boolean;
  handshakeCode: string | null;
  pairedUserIds: number[];
  profileId: string;
}

export interface UpdateTelegramSettingsInput {
  allowedUserIds?: string;
  botToken?: string;
  profileId?: string;
}

export function getTelegramConfigDir(): string {
  return join(getUserConfigDir(), "telegram");
}

export function getTelegramConfigPath(): string {
  return join(getTelegramConfigDir(), "config.ini");
}

export function maskBotToken(token: string): string | null {
  const trimmed = token.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 8) {
    return "••••••••";
  }

  return `${"•".repeat(Math.min(trimmed.length - 4, 12))}${trimmed.slice(-4)}`;
}

export function generateHandshakeCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function normalizeHandshakeInput(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

export function parseAllowedUserIds(raw: string): number[] {
  const ids = new Set<number>();

  for (const part of raw.split(",")) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    const id = Number(trimmed);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid Telegram user ID: ${trimmed}`);
    }

    ids.add(id);
  }

  return [...ids];
}

export function isTelegramUserAuthorized(
  userId: number,
  config: Pick<TelegramConfigFile, "pairedUserIds" | "allowedUserIds">
): boolean {
  return (
    config.pairedUserIds.includes(userId) ||
    config.allowedUserIds.includes(userId)
  );
}

export async function loadTelegramConfigFile(): Promise<TelegramConfigFile | null> {
  const raw = await readTextOrNull(getTelegramConfigPath());

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);
  const botToken = values.bot_token?.trim() ?? "";
  const profileId = values.profile_id?.trim() || DEFAULT_TELEGRAM_PROFILE_ID;
  const handshakeCode = values.handshake_code?.trim() || null;
  const pairedRaw = values.paired_user_ids?.trim() ?? "";
  const allowlistRaw = values.allowed_user_ids?.trim() ?? "";

  if (!botToken) {
    return null;
  }

  return {
    allowedUserIds: allowlistRaw ? parseAllowedUserIds(allowlistRaw) : [],
    botToken,
    handshakeCode,
    pairedUserIds: pairedRaw ? parseAllowedUserIds(pairedRaw) : [],
    profileId,
  };
}

export function toTelegramSettingsPublic(
  file: TelegramConfigFile | null
): TelegramSettingsPublic {
  if (!file) {
    return {
      allowedUserIds: [],
      botTokenMasked: null,
      configured: false,
      handshakeCode: null,
      pairedUserIds: [],
      profileId: DEFAULT_TELEGRAM_PROFILE_ID,
    };
  }

  return {
    allowedUserIds: file.allowedUserIds,
    botTokenMasked: maskBotToken(file.botToken),
    configured: Boolean(file.botToken.trim()),
    handshakeCode: file.handshakeCode,
    pairedUserIds: file.pairedUserIds,
    profileId: file.profileId,
  };
}

export async function loadTelegramSettingsPublic(): Promise<TelegramSettingsPublic> {
  return toTelegramSettingsPublic(await loadTelegramConfigFile());
}

async function writeTelegramConfigFile(
  config: TelegramConfigFile
): Promise<void> {
  const lines = [
    "# Nakama Telegram bridge",
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

  await writePrivateTextFile(getTelegramConfigPath(), lines.join("\n"), {
    ensureDir: getTelegramConfigDir(),
  });
}

function resolveTelegramBotToken(
  input: UpdateTelegramSettingsInput,
  existing: TelegramConfigFile | null
): string {
  return input.botToken === undefined
    ? (existing?.botToken ?? "")
    : input.botToken.trim();
}

function resolveTelegramProfileId(
  input: UpdateTelegramSettingsInput,
  existing: TelegramConfigFile | null
): string {
  return (
    input.profileId?.trim() ||
    existing?.profileId ||
    DEFAULT_TELEGRAM_PROFILE_ID
  );
}

function resolveAllowedUserIdsInput(
  input: UpdateTelegramSettingsInput,
  existing: TelegramConfigFile | null
): number[] {
  const raw =
    input.allowedUserIds === undefined
      ? (existing?.allowedUserIds.join(",") ?? "")
      : input.allowedUserIds.trim();

  return raw ? parseAllowedUserIds(raw) : [];
}

function resolveHandshakeCode(
  existing: TelegramConfigFile | null,
  allowedUserIds: number[]
): string | null {
  const pairedUserIds = existing?.pairedUserIds ?? [];
  const handshakeCode = existing?.handshakeCode ?? null;

  if (pairedUserIds.length > 0 || allowedUserIds.length > 0 || handshakeCode) {
    return handshakeCode;
  }

  return generateHandshakeCode();
}

function buildSavedTelegramConfig(
  input: UpdateTelegramSettingsInput,
  existing: TelegramConfigFile | null
): TelegramConfigFile {
  const botToken = resolveTelegramBotToken(input, existing);

  if (!botToken) {
    throw new Error("Bot token is required.");
  }

  const allowedUserIds = resolveAllowedUserIdsInput(input, existing);

  return {
    allowedUserIds,
    botToken,
    handshakeCode: resolveHandshakeCode(existing, allowedUserIds),
    pairedUserIds: existing?.pairedUserIds ?? [],
    profileId: resolveTelegramProfileId(input, existing),
  };
}

export async function saveTelegramConfig(
  input: UpdateTelegramSettingsInput
): Promise<TelegramSettingsPublic> {
  const existing = await loadTelegramConfigFile();
  const next = buildSavedTelegramConfig(input, existing);
  await writeTelegramConfigFile(next);
  return toTelegramSettingsPublic(next);
}

export async function regenerateTelegramHandshake(): Promise<TelegramSettingsPublic> {
  const existing = await loadTelegramConfigFile();

  if (!existing?.botToken.trim()) {
    throw new Error("Save a bot token before generating a pairing code.");
  }

  const next: TelegramConfigFile = {
    ...existing,
    handshakeCode: generateHandshakeCode(),
  };

  await writeTelegramConfigFile(next);
  return toTelegramSettingsPublic(next);
}

export async function verifyAndPairTelegramUser(
  handshakeInput: string,
  userId: number
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const config = await loadTelegramConfigFile();

  if (!config) {
    return {
      message: "Telegram is not configured on the server yet.",
      ok: false,
    };
  }

  if (isTelegramUserAuthorized(userId, config)) {
    return { message: "This chat is already linked.", ok: true };
  }

  const expected = config.handshakeCode;

  if (!expected) {
    return {
      message:
        "No pairing code is active. Open Nakama Integrations → Telegram and generate a new code.",
      ok: false,
    };
  }

  if (
    normalizeHandshakeInput(handshakeInput) !==
    normalizeHandshakeInput(expected)
  ) {
    return {
      message:
        "Invalid pairing code. Copy it from Integrations → Telegram and try again.",
      ok: false,
    };
  }

  const pairedUserIds = [...new Set([...config.pairedUserIds, userId])];

  await writeTelegramConfigFile({
    ...config,
    handshakeCode: null,
    pairedUserIds,
  });

  return {
    message: "Linked successfully. You can chat with Nakama now.",
    ok: true,
  };
}

export function resolveTelegramConfigFromSources(options: {
  env?: Record<string, string | undefined>;
  file?: TelegramConfigFile | null;
}): TelegramConfigFile | null {
  const env = options.env ?? process.env;
  const file = options.file ?? null;
  const botToken =
    env.TELEGRAM_BOT_TOKEN?.trim() || file?.botToken?.trim() || "";

  if (!botToken) {
    return null;
  }

  const envAllowlist = env.TELEGRAM_ALLOWED_USER_IDS?.trim();

  return {
    allowedUserIds: envAllowlist
      ? parseAllowedUserIds(envAllowlist)
      : (file?.allowedUserIds ?? []),
    botToken,
    handshakeCode: file?.handshakeCode ?? null,
    pairedUserIds: file?.pairedUserIds ?? [],
    profileId:
      env.nakama_TELEGRAM_PROFILE_ID?.trim() ||
      file?.profileId?.trim() ||
      DEFAULT_TELEGRAM_PROFILE_ID,
  };
}
