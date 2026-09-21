import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertChannelPath,
  type ChannelConfigScope,
  claimChannelIdentity,
  generateHandshakeCode,
  getChannelConfigDir,
  isBotChannelUserAuthorized,
  isChannelOwner,
  listChannelOwners,
  loadBotChannelIniConfig,
  maskBotToken,
  releaseChannelClaims,
  resetChannelConversationState,
  resolveHandshakeCodeOnSave,
  verifyAndPairBotChannelUser,
  writeBotChannelIniConfig,
} from "./channel-config-shared";
import { readEnvValue } from "./config";
import { ensureDir, pathExists, readDirectoryOrEmpty } from "./fs";
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
  pairedUserIds?: string;
  profileId?: string;
}

/**
 * Config scope. An org id reads that org's own credentials; `null` reads the
 * install-wide config that predates per-org channels and still serves every
 * org that has not saved its own.
 */
export type TelegramConfigScope = ChannelConfigScope;

export function getTelegramConfigDir(orgId: TelegramConfigScope): string {
  return getChannelConfigDir("telegram", orgId);
}

export function getTelegramConfigPath(orgId: TelegramConfigScope): string {
  const path = join(getTelegramConfigDir(orgId), "config.ini");
  if (isChannelOwner(orgId)) {
    assertChannelPath(path);
    assertChannelPath(`${path}.tmp`);
  }
  return path;
}

/** Org ids that have saved their own Telegram credentials. */
export async function listTelegramConfigOrgIds(): Promise<string[]> {
  const orgIds = await readDirectoryOrEmpty(join(getUserConfigDir(), "orgs"));
  const configured: string[] = [];

  for (const orgId of orgIds) {
    if (await pathExists(getTelegramConfigPath(orgId))) {
      configured.push(orgId);
    }
  }

  return configured;
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

export async function loadTelegramConfigFile(
  orgId: TelegramConfigScope
): Promise<TelegramConfigFile | null> {
  return loadBotChannelIniConfig({
    configPath: getTelegramConfigPath(orgId),
    defaultProfileId: DEFAULT_TELEGRAM_PROFILE_ID,
    parseUserIds: parseAllowedUserIds,
  });
}

/**
 * Which config actually serves this org: its own when it has one, otherwise the
 * install-wide config, which is the bot that has been answering its users all
 * along.
 */
export async function resolveTelegramScopeForOrg(
  orgId: TelegramConfigScope
): Promise<TelegramConfigScope> {
  if (isChannelOwner(orgId)) {
    return orgId;
  }
  if (orgId === null) {
    return null;
  }

  return (await pathExists(getTelegramConfigPath(orgId))) ? orgId : null;
}

/**
 * Pre-org installs keep one Telegram config at the config-dir root. On a
 * single-org install it can only belong to that org, so move the directory
 * once and take the chat sessions and pairings with it. Multi-org installs
 * keep the shared bot until an admin saves credentials of their own.
 */
export async function claimLegacyTelegramConfig(
  orgId: string
): Promise<boolean> {
  const legacyDir = getTelegramConfigDir(null);
  const targetDir = getTelegramConfigDir(orgId);

  if (!(await pathExists(join(legacyDir, "config.ini")))) {
    return false;
  }

  if (await pathExists(targetDir)) {
    return false;
  }

  await ensureDir(dirname(targetDir));
  await rename(legacyDir, targetDir);
  return true;
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

export async function loadTelegramSettingsPublic(
  orgId: TelegramConfigScope
): Promise<TelegramSettingsPublic> {
  return toTelegramSettingsPublic(await loadTelegramConfigFile(orgId));
}

async function writeTelegramConfigFile(
  orgId: TelegramConfigScope,
  config: TelegramConfigFile
): Promise<void> {
  await writeBotChannelIniConfig({
    config,
    configDir: getTelegramConfigDir(orgId),
    configPath: getTelegramConfigPath(orgId),
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
  const pairedUserIds =
    input.pairedUserIds === undefined
      ? (existing?.pairedUserIds ?? [])
      : parseAllowedUserIds(input.pairedUserIds);

  return {
    allowedUserIds,
    botToken,
    handshakeCode: resolveHandshakeCodeOnSave(existing, allowedUserIds),
    pairedUserIds,
    profileId: resolveTelegramProfileId(input, existing),
  };
}

export async function saveTelegramConfig(
  orgId: TelegramConfigScope,
  input: UpdateTelegramSettingsInput
): Promise<TelegramSettingsPublic> {
  const existing = await loadTelegramConfigFile(orgId);
  const changed =
    existing &&
    input.botToken !== undefined &&
    existing.botToken !== input.botToken.trim();
  const next = buildSavedTelegramConfig(input, changed ? null : existing);
  if (isChannelOwner(orgId)) {
    next.profileId = orgId.profileId;
  }
  await assertTelegramTokenUnclaimed(orgId, next.botToken);
  const rollback = isChannelOwner(orgId)
    ? await claimChannelIdentity(
        "telegram",
        orgId,
        next.botToken.split(":")[0]!
      )
    : async () => {};
  try {
    if (changed && isChannelOwner(orgId)) {
      await resetChannelConversationState("telegram", orgId);
    }
    await writeTelegramConfigFile(orgId, next);
  } catch (error) {
    await rollback();
    throw error;
  }
  if (isChannelOwner(orgId)) {
    await releaseChannelClaims("telegram", orgId, next.botToken.split(":")[0]!);
  }
  return toTelegramSettingsPublic(next);
}

/**
 * Telegram drops updates for whichever poller is not last, so two scopes on one
 * token silently lose messages instead of failing. Reject it at save time.
 */
async function assertTelegramTokenUnclaimed(
  orgId: TelegramConfigScope,
  botToken: string
): Promise<void> {
  const scopes: TelegramConfigScope[] = [
    null,
    ...(await listTelegramConfigOrgIds()),
    ...(await listChannelOwners("telegram")),
  ];

  for (const scope of scopes) {
    if (getTelegramConfigDir(scope) === getTelegramConfigDir(orgId)) {
      continue;
    }

    const config = await loadTelegramConfigFile(scope);

    if (config?.botToken === botToken) {
      throw new Error(
        "This bot token is already in use by another organization. Create a separate bot with @BotFather."
      );
    }
  }
}

export async function regenerateTelegramHandshake(
  orgId: TelegramConfigScope
): Promise<TelegramSettingsPublic> {
  const existing = await loadTelegramConfigFile(orgId);

  if (!existing?.botToken.trim()) {
    throw new Error("Save a bot token before generating a pairing code.");
  }

  const next: TelegramConfigFile = {
    ...existing,
    handshakeCode: generateHandshakeCode(),
  };

  await writeTelegramConfigFile(orgId, next);
  return toTelegramSettingsPublic(next);
}

export async function verifyAndPairTelegramUser(
  orgId: TelegramConfigScope,
  handshakeInput: string,
  userId: number
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  return verifyAndPairBotChannelUser({
    handshakeInput,
    isAuthorized: isTelegramUserAuthorized,
    label: "Telegram",
    load: () => loadTelegramConfigFile(orgId),
    userId,
    write: (config) => writeTelegramConfigFile(orgId, config),
  });
}

export function resolveTelegramConfigFromSources(options: {
  env?: Record<string, string | undefined>;
  file?: TelegramConfigFile | null;
}): TelegramConfigFile | null {
  const env = options.env ?? process.env;
  const file = options.file ?? null;
  const botToken =
    readEnvValue(env, "TELEGRAM_BOT_TOKEN") || file?.botToken?.trim() || "";

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
      env.NAKAMA_TELEGRAM_PROFILE_ID?.trim() ||
      file?.profileId?.trim() ||
      DEFAULT_TELEGRAM_PROFILE_ID,
  };
}
