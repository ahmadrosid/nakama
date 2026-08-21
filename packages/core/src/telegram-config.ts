import { join } from "node:path";
import {
  generateHandshakeCode,
  isBotChannelUserAuthorized,
  loadBotChannelIniConfig,
  maskBotToken,
  resolveHandshakeCodeOnSave,
  verifyAndPairBotChannelUser,
  writeBotChannelIniConfig,
} from "./channel-config-shared";
import { getUserConfigDir } from "./user-config";

export {
  generateHandshakeCode,
  maskBotToken,
  normalizeHandshakeInput,
} from "./channel-config-shared";

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
  return isBotChannelUserAuthorized(userId, config);
}

export async function loadTelegramConfigFile(): Promise<TelegramConfigFile | null> {
  return loadBotChannelIniConfig({
    configPath: getTelegramConfigPath(),
    defaultProfileId: DEFAULT_TELEGRAM_PROFILE_ID,
    parseUserIds: parseAllowedUserIds,
  });
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
  await writeBotChannelIniConfig({
    config,
    configDir: getTelegramConfigDir(),
    configPath: getTelegramConfigPath(),
    label: "Telegram",
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
    handshakeCode: resolveHandshakeCodeOnSave(existing, allowedUserIds),
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
  return verifyAndPairBotChannelUser({
    handshakeInput,
    isAuthorized: isTelegramUserAuthorized,
    label: "Telegram",
    load: loadTelegramConfigFile,
    userId,
    write: writeTelegramConfigFile,
  });
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
