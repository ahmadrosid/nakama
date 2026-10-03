import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  parseIni,
  readDirectoryOrEmpty,
  readTextOrNull,
  writeTextFile,
} from "./fs";
import {
  createPairingCodeSecret,
  fingerprintPairingCode,
  getPairingAttemptBudget,
  isPairingCodeActive,
  type PairingCodeSecret,
  pairingCodesMatch,
  pairingFailureMessage,
} from "./pairing-code";
import { maskTrailingSecret } from "./secret-mask";
import { getOrgConfigDir, getUserConfigDir } from "./user-config";

export {
  createPairingCodeSecret,
  generatePairingCode,
  isPairingCodeActive,
  looksLikePairingCode,
  PAIRING_CODE_TTL_MS,
  resetPairingAttemptBudget,
} from "./pairing-code";

export type ChannelPlatform = "telegram" | "discord" | "whatsapp" | "slack";
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

/** A crashed bridge must not wedge pairing forever, so a lock goes stale. */
const PAIRING_LOCK_STALE_MS = 15_000;
const PAIRING_LOCK_WAIT_MS = 5000;
const PAIRING_LOCK_FILE = "pairing.lock";

export class ChannelConfigBusyError extends Error {}

/**
 * Serializes pairing transactions through an exclusive lock file, so two
 * bridges sharing a config directory cannot both consume the same code.
 */
export async function withPairingConfigLock<T>(
  configDir: string,
  run: () => Promise<T>
): Promise<T> {
  const path = join(configDir, PAIRING_LOCK_FILE);
  assertChannelPath(path);
  await mkdir(configDir, { mode: 0o700, recursive: true });
  const deadline = Date.now() + PAIRING_LOCK_WAIT_MS;

  for (;;) {
    try {
      await writeFile(path, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const held = await lstat(path).catch(() => null);

      if (!held) {
        continue;
      }

      if (Date.now() - held.mtimeMs > PAIRING_LOCK_STALE_MS) {
        await rm(path, { force: true });
        continue;
      }

      if (Date.now() >= deadline) {
        throw new ChannelConfigBusyError("Pairing is already in progress.");
      }

      await sleep(25);
    }
  }

  try {
    return await run();
  } finally {
    await rm(path, { force: true });
  }
}

export type HandshakeSecret = {
  handshakeCode: string | null;
  handshakeExpiresAt: string | null;
};

export type BotChannelConfigFile<TId extends string | number> = {
  allowedUserIds: TId[];
  botToken: string;
  handshakeCode: string | null;
  handshakeExpiresAt: string | null;
  pairedUserIds: TId[];
  profileId: string;
};

/** A stored code is only usable while its own expiry is still in the future. */
export function hasActiveHandshakeCode(
  config: Pick<
    BotChannelConfigFile<string | number>,
    "handshakeCode" | "handshakeExpiresAt"
  > | null,
  now = Date.now()
): boolean {
  return isPairingCodeActive(
    config?.handshakeCode ?? null,
    config?.handshakeExpiresAt ?? null,
    now
  );
}

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

export function resolveHandshakeOnSave<TId extends string | number>(
  existing: Pick<
    BotChannelConfigFile<TId>,
    "handshakeCode" | "handshakeExpiresAt" | "pairedUserIds"
  > | null,
  allowedUserIds: TId[]
): HandshakeSecret {
  const pairedUserIds = existing?.pairedUserIds ?? [];
  const stored: HandshakeSecret = {
    handshakeCode: existing?.handshakeCode ?? null,
    handshakeExpiresAt: existing?.handshakeExpiresAt ?? null,
  };

  if (
    pairedUserIds.length > 0 ||
    allowedUserIds.length > 0 ||
    hasActiveHandshakeCode(existing)
  ) {
    return stored;
  }

  return toHandshakeSecret(createPairingCodeSecret());
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
  const handshakeExpiresAt = values.handshake_expires_at?.trim() || null;
  const pairedRaw = values.paired_user_ids?.trim() ?? "";
  const allowlistRaw = values.allowed_user_ids?.trim() ?? "";

  if (!botToken) {
    return null;
  }

  return {
    allowedUserIds: allowlistRaw ? options.parseUserIds(allowlistRaw) : [],
    botToken,
    handshakeCode,
    handshakeExpiresAt,
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
    ...(config.handshakeCode
      ? [
          `handshake_code=${config.handshakeCode}`,
          ...(config.handshakeExpiresAt
            ? [`handshake_expires_at=${config.handshakeExpiresAt}`]
            : []),
        ]
      : []),
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

/**
 * One pairing transaction: check the budget, compare in constant time, then
 * consume the code under an exclusive lock. Every rejection returns the same
 * message, so an attacker cannot tell an expired code from a wrong one.
 */
export async function verifyAndPairBotChannelUser<
  TId extends string | number,
  TConfig extends BotChannelConfigFile<TId> = BotChannelConfigFile<TId>,
>(options: {
  /** Channel config directory: the pairing lock and attempt budget both key off it. */
  configDir: string;
  handshakeInput: string;
  isAuthorized: (
    userId: TId,
    config: Pick<BotChannelConfigFile<TId>, "pairedUserIds" | "allowedUserIds">
  ) => boolean;
  label: string;
  load: () => Promise<TConfig | null>;
  /** Network the guess arrived from. */
  sourceKey: string;
  userId: TId;
  write: (config: TConfig) => Promise<void>;
}): Promise<ChannelPairResult> {
  const failure: ChannelPairResult = {
    message: pairingFailureMessage(options.label),
    ok: false,
  };

  try {
    return await withPairingConfigLock(options.configDir, async () => {
      const config = await options.load();

      if (!config) {
        return failure;
      }

      if (options.isAuthorized(options.userId, config)) {
        return { message: "This chat is already linked.", ok: true };
      }

      if (!hasActiveHandshakeCode(config)) {
        return failure;
      }

      const expected = config.handshakeCode as string;
      const budget = getPairingAttemptBudget(options.configDir);
      const attempt = {
        codeFingerprint: fingerprintPairingCode(expected),
        senderKey: String(options.userId),
        sourceKey: options.sourceKey,
      };

      if (budget.blocked(attempt) !== null) {
        return failure;
      }

      if (!pairingCodesMatch(options.handshakeInput, expected)) {
        // Exhausting the per-code budget retires the code, so a guessing run
        // cannot keep at the same secret.
        if (budget.recordFailure(attempt) === "code") {
          await options.write({ ...config, ...SPENT_HANDSHAKE });
        }
        return failure;
      }

      const pairedUserIds = [
        ...new Set([...config.pairedUserIds, options.userId]),
      ];

      await options.write({ ...config, ...SPENT_HANDSHAKE, pairedUserIds });

      return {
        message: "Linked successfully. You can chat with Nakama now.",
        ok: true,
      };
    });
  } catch (error) {
    if (error instanceof ChannelConfigBusyError) {
      return failure;
    }
    throw error;
  }
}

const SPENT_HANDSHAKE: HandshakeSecret = {
  handshakeCode: null,
  handshakeExpiresAt: null,
};

function toHandshakeSecret(secret: PairingCodeSecret): HandshakeSecret {
  return { handshakeCode: secret.code, handshakeExpiresAt: secret.expiresAt };
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
