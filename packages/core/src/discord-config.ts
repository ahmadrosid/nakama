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

export const DEFAULT_DISCORD_PROFILE_ID = "default";

export const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
export const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

export function isDiscordSnowflake(value: string): boolean {
  return SNOWFLAKE_PATTERN.test(value);
}

export interface DiscordConfigFile {
  allowedUserIds: string[];
  botToken: string;
  handshakeCode: string | null;
  pairedUserIds: string[];
  profileId: string;
}

export interface DiscordSettingsPublic {
  allowedUserIds: string[];
  botTokenMasked: string | null;
  configured: boolean;
  handshakeCode: string | null;
  inviteUrl: string | null;
  pairedUserIds: string[];
  profileId: string;
}

export interface UpdateDiscordSettingsInput {
  allowedUserIds?: string;
  botToken?: string;
  profileId?: string;
}

export function getDiscordConfigDir(): string {
  return join(getUserConfigDir(), "discord");
}

export function getDiscordConfigPath(): string {
  return join(getDiscordConfigDir(), "config.ini");
}

const DISCORD_INVITE_PERMISSIONS = 101_376; // 68608 | 32768 (Attach Files)
const DISCORD_INVITE_SCOPES = "bot applications.commands";

const discordApplicationIdCache = new Map<string, string>();

export function buildDiscordInviteUrl(applicationId: string): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    permissions: String(DISCORD_INVITE_PERMISSIONS),
    scope: DISCORD_INVITE_SCOPES,
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function clearDiscordApplicationIdCache(botToken: string): void {
  discordApplicationIdCache.delete(botToken.trim());
}

export async function resolveDiscordApplicationId(
  botToken: string
): Promise<string | null> {
  const token = botToken.trim();

  if (!token) {
    return null;
  }

  const cached = discordApplicationIdCache.get(token);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE_URL}/oauth2/applications/@me`,
      {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { id?: string };
    const applicationId = payload.id?.trim();

    if (!(applicationId && SNOWFLAKE_PATTERN.test(applicationId))) {
      return null;
    }

    discordApplicationIdCache.set(token, applicationId);
    return applicationId;
  } catch {
    return null;
  }
}

async function withDiscordInviteUrl(
  settings: DiscordSettingsPublic,
  botToken: string | null
): Promise<DiscordSettingsPublic> {
  if (!(settings.configured && botToken?.trim())) {
    return settings;
  }

  const applicationId = await resolveDiscordApplicationId(botToken);

  return {
    ...settings,
    inviteUrl: applicationId ? buildDiscordInviteUrl(applicationId) : null,
  };
}

export function parseAllowedUserIds(raw: string): string[] {
  const ids = new Set<string>();

  for (const part of raw.split(",")) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    if (!SNOWFLAKE_PATTERN.test(trimmed)) {
      throw new Error(`Invalid Discord user ID: ${trimmed}`);
    }

    ids.add(trimmed);
  }

  return [...ids];
}

export function isDiscordUserAuthorized(
  userId: string,
  config: Pick<DiscordConfigFile, "pairedUserIds" | "allowedUserIds">
): boolean {
  return isBotChannelUserAuthorized(userId, config);
}

async function loadDiscordConfigFile(): Promise<DiscordConfigFile | null> {
  return loadBotChannelIniConfig({
    configPath: getDiscordConfigPath(),
    defaultProfileId: DEFAULT_DISCORD_PROFILE_ID,
    parseUserIds: parseAllowedUserIds,
  });
}

export { loadDiscordConfigFile };

export function toDiscordSettingsPublic(
  file: DiscordConfigFile | null
): DiscordSettingsPublic {
  if (!file) {
    return {
      allowedUserIds: [],
      botTokenMasked: null,
      configured: false,
      handshakeCode: null,
      inviteUrl: null,
      pairedUserIds: [],
      profileId: DEFAULT_DISCORD_PROFILE_ID,
    };
  }

  return {
    allowedUserIds: file.allowedUserIds,
    botTokenMasked: maskBotToken(file.botToken),
    configured: Boolean(file.botToken.trim()),
    handshakeCode: file.handshakeCode,
    inviteUrl: null,
    pairedUserIds: file.pairedUserIds,
    profileId: file.profileId,
  };
}

export async function loadDiscordSettingsPublic(): Promise<DiscordSettingsPublic> {
  const file = await loadDiscordConfigFile();
  const base = toDiscordSettingsPublic(file);
  return withDiscordInviteUrl(base, file?.botToken ?? null);
}

async function writeDiscordConfigFile(
  config: DiscordConfigFile
): Promise<void> {
  await writeBotChannelIniConfig({
    config,
    configDir: getDiscordConfigDir(),
    configPath: getDiscordConfigPath(),
    label: "Discord",
  });
}

function resolveDiscordBotToken(
  input: UpdateDiscordSettingsInput,
  existing: DiscordConfigFile | null
): string {
  return input.botToken === undefined
    ? (existing?.botToken ?? "")
    : input.botToken.trim();
}

function resolveDiscordProfileId(
  input: UpdateDiscordSettingsInput,
  existing: DiscordConfigFile | null
): string {
  return (
    input.profileId?.trim() || existing?.profileId || DEFAULT_DISCORD_PROFILE_ID
  );
}

function resolveAllowedUserIdsInput(
  input: UpdateDiscordSettingsInput,
  existing: DiscordConfigFile | null
): string[] {
  const raw =
    input.allowedUserIds === undefined
      ? (existing?.allowedUserIds.join(",") ?? "")
      : input.allowedUserIds.trim();

  return raw ? parseAllowedUserIds(raw) : [];
}

function buildSavedDiscordConfig(
  input: UpdateDiscordSettingsInput,
  existing: DiscordConfigFile | null
): DiscordConfigFile {
  const botToken = resolveDiscordBotToken(input, existing);

  if (!botToken) {
    throw new Error("Bot token is required.");
  }

  const allowedUserIds = resolveAllowedUserIdsInput(input, existing);

  return {
    allowedUserIds,
    botToken,
    handshakeCode: resolveHandshakeCodeOnSave(existing, allowedUserIds),
    pairedUserIds: existing?.pairedUserIds ?? [],
    profileId: resolveDiscordProfileId(input, existing),
  };
}

export async function saveDiscordConfig(
  input: UpdateDiscordSettingsInput
): Promise<DiscordSettingsPublic> {
  const existing = await loadDiscordConfigFile();
  const next = buildSavedDiscordConfig(input, existing);

  if (
    existing?.botToken.trim() &&
    existing.botToken.trim() !== next.botToken.trim()
  ) {
    clearDiscordApplicationIdCache(existing.botToken);
  }

  await writeDiscordConfigFile(next);
  return withDiscordInviteUrl(toDiscordSettingsPublic(next), next.botToken);
}

export async function addDiscordAllowedUserId(
  userId: string
): Promise<
  | { alreadyAllowed: boolean; ok: true; userId: string }
  | { message: string; ok: false }
> {
  const trimmed = userId.trim();

  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    return { message: "Invalid Discord user ID.", ok: false };
  }

  const config = await loadDiscordConfigFile();

  if (!config) {
    return {
      message: "Discord is not configured on the server yet.",
      ok: false,
    };
  }

  if (config.allowedUserIds.includes(trimmed)) {
    return { alreadyAllowed: true, ok: true, userId: trimmed };
  }

  try {
    await writeDiscordConfigFile({
      ...config,
      allowedUserIds: [...config.allowedUserIds, trimmed],
    });
  } catch {
    return {
      message: "Could not update the Discord allowed list.",
      ok: false,
    };
  }

  return { alreadyAllowed: false, ok: true, userId: trimmed };
}

export async function regenerateDiscordHandshake(): Promise<DiscordSettingsPublic> {
  const existing = await loadDiscordConfigFile();

  if (!existing?.botToken.trim()) {
    throw new Error("Save a bot token before generating a pairing code.");
  }

  const next: DiscordConfigFile = {
    ...existing,
    handshakeCode: generateHandshakeCode(),
  };

  await writeDiscordConfigFile(next);
  return withDiscordInviteUrl(toDiscordSettingsPublic(next), next.botToken);
}

export async function verifyAndPairDiscordUser(
  handshakeInput: string,
  userId: string
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  return verifyAndPairBotChannelUser({
    handshakeInput,
    isAuthorized: isDiscordUserAuthorized,
    label: "Discord",
    load: loadDiscordConfigFile,
    userId,
    write: writeDiscordConfigFile,
  });
}

export function resolveDiscordConfigFromSources(options: {
  env?: Record<string, string | undefined>;
  file?: DiscordConfigFile | null;
}): DiscordConfigFile | null {
  const env = options.env ?? process.env;
  const file = options.file ?? null;
  const botToken =
    env.DISCORD_BOT_TOKEN?.trim() || file?.botToken?.trim() || "";

  if (!botToken) {
    return null;
  }

  const envAllowlist = env.DISCORD_ALLOWED_USER_IDS?.trim();

  return {
    allowedUserIds: envAllowlist
      ? parseAllowedUserIds(envAllowlist)
      : (file?.allowedUserIds ?? []),
    botToken,
    handshakeCode: file?.handshakeCode ?? null,
    pairedUserIds: file?.pairedUserIds ?? [],
    profileId:
      env.nakama_DISCORD_PROFILE_ID?.trim() ||
      file?.profileId?.trim() ||
      DEFAULT_DISCORD_PROFILE_ID,
  };
}
