import { createHash, randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  parseIni,
  readDirectoryOrEmpty,
  readTextOrNull,
  writeTextFile,
} from "./fs";
import { maskTrailingSecret } from "./secret-mask";
import { getOrgConfigDir, getUserConfigDir } from "./user-config";

export type ChannelPlatform = "telegram" | "discord" | "whatsapp";
export interface ChannelOwner {
  orgId: string;
  profileId: string;
}

/** String/null scopes are retained solely for reading and migrating old installations. */
export type ChannelConfigScope = ChannelOwner | string | null;

export function isChannelOwner(
  scope: ChannelConfigScope
): scope is ChannelOwner {
  return scope !== null && typeof scope === "object";
}

export function getChannelConfigDir(
  platform: ChannelPlatform,
  scope: ChannelConfigScope
): string {
  if (!isChannelOwner(scope)) {
    return join(
      scope === null ? getUserConfigDir() : getOrgConfigDir(scope),
      platform
    );
  }
  if (!/^[A-Za-z0-9][\w.-]{0,127}$/.test(scope.profileId)) {
    throw new Error("Invalid profile id");
  }
  const directory = join(
    getOrgConfigDir(scope.orgId),
    "channels",
    scope.profileId,
    platform
  );
  assertChannelPath(directory);
  return directory;
}

/** Refuse symlinks anywhere below the configured root, including the credential file. */
export function assertChannelPath(path: string): void {
  const root = resolve(getUserConfigDir());
  const parts = relative(root, resolve(path)).split(sep);
  if (parts.includes("..")) {
    throw new Error("Invalid channel path");
  }
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error("Channel paths cannot contain symbolic links");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function listChannelOwners(
  platform: ChannelPlatform
): Promise<ChannelOwner[]> {
  const owners: ChannelOwner[] = [];
  for (const orgId of await readDirectoryOrEmpty(
    join(getUserConfigDir(), "orgs")
  )) {
    for (const profileId of await readDirectoryOrEmpty(
      join(getOrgConfigDir(orgId), "channels")
    )) {
      const owner = { orgId, profileId };
      const path = join(getChannelConfigDir(platform, owner), "config.ini");
      assertChannelPath(path);
      if (await readTextOrNull(path)) {
        owners.push(owner);
      }
    }
  }
  return owners;
}

/** Exclusive creation makes duplicate account claims atomic across server processes. */
export async function claimChannelIdentity(
  platform: ChannelPlatform,
  owner: ChannelOwner,
  identity: string
): Promise<() => Promise<void>> {
  getChannelConfigDir(platform, owner);
  if (!identity.trim()) {
    throw new Error("Missing channel account identity");
  }
  const directory = join(getUserConfigDir(), "channel-claims", platform);
  const path = join(
    directory,
    createHash("sha256").update(identity).digest("hex")
  );
  assertChannelPath(path);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const value = JSON.stringify([owner.orgId, owner.profileId]);
  try {
    await writeFile(path, value, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    if ((await readFile(path, "utf8")) !== value) {
      throw new Error(
        "This channel account is already in use by another agent."
      );
    }
    return async () => {};
  }
  return async () => {
    await unlink(path);
  };
}

export async function removeChannelConnection(
  platform: ChannelPlatform,
  owner: ChannelOwner
): Promise<void> {
  await rm(getChannelConfigDir(platform, owner), {
    force: true,
    recursive: true,
  });
  await releaseChannelClaims(platform, owner);
}

export async function resetChannelConversationState(
  platform: ChannelPlatform,
  owner: ChannelOwner
): Promise<void> {
  for (const name of [
    "chat-sessions.json",
    "chat-threads.json",
    "org-selection.json",
  ]) {
    const path = join(getChannelConfigDir(platform, owner), name);
    assertChannelPath(path);
    await rm(path, { force: true });
  }
}

export async function releaseChannelClaims(
  platform: ChannelPlatform,
  owner: ChannelOwner,
  keepIdentity?: string
): Promise<void> {
  const keep = keepIdentity
    ? createHash("sha256").update(keepIdentity).digest("hex")
    : null;
  const directory = join(getUserConfigDir(), "channel-claims", platform);
  const value = JSON.stringify([owner.orgId, owner.profileId]);
  for (const entry of await readDirectoryOrEmpty(directory)) {
    const path = join(directory, entry);
    assertChannelPath(path);
    if (entry !== keep && (await readTextOrNull(path)) === value) {
      await unlink(path);
    }
  }
}

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
      message: `No pairing code is active. Open this agent’s Connections → ${options.label} and generate a new code.`,
      ok: false,
    };
  }

  if (
    normalizeHandshakeInput(options.handshakeInput) !==
    normalizeHandshakeInput(expected)
  ) {
    return {
      message: `Invalid pairing code. Copy it from this agent’s Connections → ${options.label} and try again.`,
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

export function channelOwnerFromEnv(
  env: Record<string, string | undefined> = process.env
): ChannelOwner {
  const orgId = env.NAKAMA_CHANNEL_ORG_ID?.trim();
  const profileId = env.NAKAMA_CHANNEL_PROFILE_ID?.trim();
  if (!(orgId && profileId)) {
    throw new Error("Channel workers require an organization and agent scope.");
  }
  const owner = { orgId, profileId };
  getChannelConfigDir("telegram", owner);
  return owner;
}
