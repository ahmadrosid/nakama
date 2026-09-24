import { join } from "node:path";
import {
  assertChannelPath,
  type BotChannelConfigFile,
  type ChannelOwner,
  claimChannelIdentity,
  generateHandshakeCode,
  getChannelConfigDir,
  isBotChannelUserAuthorized,
  maskBotToken,
  releaseChannelClaims,
  resetChannelConversationState,
  resolveHandshakeCodeOnSave,
  verifyAndPairBotChannelUser,
} from "./channel-config-shared";
import { parseSlackMemberIdInput } from "./contract";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";

export const DEFAULT_SLACK_PROFILE_ID = "default";
export const SLACK_API_BASE_URL = "https://slack.com/api";

export interface SlackConfigFile extends BotChannelConfigFile<string> {
  /** Any full member of the bot's own workspace may chat, without pairing. */
  allowWorkspace: boolean;
  /** App-level token (`xapp-`) that opens the Socket Mode connection. */
  appToken: string;
}

export interface SlackSettingsPublic {
  allowedUserIds: string[];
  allowWorkspace: boolean;
  appTokenMasked: string | null;
  botTokenMasked: string | null;
  configured: boolean;
  handshakeCode: string | null;
  pairedUserIds: string[];
  profileId: string;
}

export interface UpdateSlackSettingsInput {
  allowedUserIds?: string;
  allowWorkspace?: boolean;
  appToken?: string;
  botToken?: string;
}

/** A Slack connection belongs to one agent, like the other channels. */
export function getSlackConfigDir(owner: ChannelOwner): string {
  return getChannelConfigDir("slack", owner);
}

export function getSlackConfigPath(owner: ChannelOwner): string {
  const path = join(getSlackConfigDir(owner), "config.ini");
  assertChannelPath(path);
  assertChannelPath(`${path}.tmp`);
  return path;
}

/** Calls a Slack Web API method and throws with Slack's error code when `ok` is false. */
export async function callSlackApi<T extends object = object>(
  method: string,
  token: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  // Read methods such as users.info ignore JSON bodies, and form encoding
  // works for every method, so JSON is only used for nested values (blocks).
  const flat = Object.values(body).every(
    (value) => value === undefined || typeof value === "string"
  );
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
    body: flat
      ? new URLSearchParams(
          Object.entries(body).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
          )
        )
      : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(flat ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as T & {
    error?: string;
    ok?: boolean;
  };

  if (!payload.ok) {
    throw new Error(
      `Slack ${method} failed: ${payload.error ?? response.status}`
    );
  }

  return payload;
}

export function parseSlackUserIds(raw: string): string[] {
  const { ids, invalid } = parseSlackMemberIdInput(raw);

  if (invalid.length > 0) {
    throw new Error(`Invalid Slack member ID: ${invalid[0]}`);
  }

  return ids;
}

export function isSlackUserAuthorized(
  userId: string,
  config: Pick<SlackConfigFile, "pairedUserIds" | "allowedUserIds">
): boolean {
  return isBotChannelUserAuthorized(userId, config);
}

export async function loadSlackConfigFile(
  owner: ChannelOwner
): Promise<SlackConfigFile | null> {
  const raw = await readTextOrNull(getSlackConfigPath(owner));

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);
  const botToken = values.bot_token?.trim() ?? "";

  if (!botToken) {
    return null;
  }

  const paired = values.paired_user_ids?.trim() ?? "";
  const allowed = values.allowed_user_ids?.trim() ?? "";

  return {
    allowedUserIds: allowed ? parseSlackUserIds(allowed) : [],
    allowWorkspace: values.allow_workspace?.trim() === "true",
    appToken: values.app_token?.trim() ?? "",
    botToken,
    handshakeCode: values.handshake_code?.trim() || null,
    pairedUserIds: paired ? parseSlackUserIds(paired) : [],
    profileId: values.profile_id?.trim() || DEFAULT_SLACK_PROFILE_ID,
  };
}

async function writeSlackConfigFile(
  owner: ChannelOwner,
  config: SlackConfigFile
): Promise<void> {
  const lines = [
    "# Nakama Slack bridge",
    `bot_token=${config.botToken}`,
    `app_token=${config.appToken}`,
    `profile_id=${config.profileId}`,
    ...(config.allowWorkspace ? ["allow_workspace=true"] : []),
    ...(config.handshakeCode ? [`handshake_code=${config.handshakeCode}`] : []),
    ...(config.pairedUserIds.length > 0
      ? [`paired_user_ids=${config.pairedUserIds.join(",")}`]
      : []),
    ...(config.allowedUserIds.length > 0
      ? [`allowed_user_ids=${config.allowedUserIds.join(",")}`]
      : []),
    "",
  ];

  await writeTextFile(getSlackConfigPath(owner), lines.join("\n"), {
    ensureDir: getSlackConfigDir(owner),
  });
}

export function toSlackSettingsPublic(
  file: SlackConfigFile | null
): SlackSettingsPublic {
  return {
    allowedUserIds: file?.allowedUserIds ?? [],
    allowWorkspace: file?.allowWorkspace ?? false,
    appTokenMasked: file?.appToken ? maskBotToken(file.appToken) : null,
    botTokenMasked: file ? maskBotToken(file.botToken) : null,
    configured: Boolean(file?.botToken && file.appToken),
    handshakeCode: file?.handshakeCode ?? null,
    pairedUserIds: file?.pairedUserIds ?? [],
    profileId: file?.profileId ?? DEFAULT_SLACK_PROFILE_ID,
  };
}

export async function loadSlackSettingsPublic(
  owner: ChannelOwner
): Promise<SlackSettingsPublic> {
  return toSlackSettingsPublic(await loadSlackConfigFile(owner));
}

/** Rejects tokens Slack does not accept before they reach the config file. */
export async function validateSlackTokens(tokens: {
  appToken?: string;
  botToken?: string;
}): Promise<void> {
  if (tokens.botToken !== undefined) {
    if (!tokens.botToken.startsWith("xoxb-")) {
      throw new Error("Bot token must start with xoxb-.");
    }
    await callSlackApi("auth.test", tokens.botToken);
  }

  if (tokens.appToken !== undefined) {
    if (!tokens.appToken.startsWith("xapp-")) {
      throw new Error("App token must start with xapp-.");
    }
    // Fails with not_allowed_token_type / invalid_auth when Socket Mode or
    // the connections:write scope is missing. The returned URL is discarded.
    await callSlackApi("apps.connections.open", tokens.appToken);
  }
}

/**
 * Both tokens must come from one Slack app: the socket delivers the app
 * token's events, while replies and the mention check use the bot token's
 * identity. bots.info (users:read) names the bot's app; without that scope
 * the check is skipped because Slack will not answer it.
 */
export async function checkSlackTokensMatch(tokens: {
  appToken: string;
  botToken: string;
}): Promise<void> {
  const appId = slackAppIdFromToken(tokens.appToken);
  if (!appId) {
    return;
  }
  const { bot_id: botId } = await callSlackApi<{ bot_id: string }>(
    "auth.test",
    tokens.botToken
  );
  let botAppId: string | undefined;
  try {
    ({
      bot: { app_id: botAppId },
    } = await callSlackApi<{ bot: { app_id?: string } }>(
      "bots.info",
      tokens.botToken,
      { bot: botId }
    ));
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("missing_scope")) {
      return;
    }
    throw error;
  }
  if (botAppId && botAppId !== appId) {
    throw new Error(
      "The bot token and the app token come from different Slack apps. Copy both from the same app."
    );
  }
}

/** What the workspace gate needs to know about a Slack member (users.info). */
export interface SlackMember {
  deleted?: boolean;
  is_bot?: boolean;
  is_restricted?: boolean;
  is_stranger?: boolean;
  is_ultra_restricted?: boolean;
  team_id?: string;
}

/**
 * The workspace gate: a full member of the bot's own team. Guests (restricted,
 * ultra restricted), people from other orgs in shared channels, bots and
 * deactivated accounts still need pairing or the allowed list.
 * ponytail: plain team match, so Enterprise Grid members of a sibling
 * workspace are refused; compare enterprise_id if a grid install needs them.
 */
export function isSlackWorkspaceMember(
  member: SlackMember,
  botTeamId: string
): boolean {
  return (
    member.team_id === botTeamId &&
    !(
      member.deleted ||
      member.is_bot ||
      member.is_restricted ||
      member.is_ultra_restricted ||
      member.is_stranger
    )
  );
}

/** Workspace access reads users.info, which needs the users:read scope. */
export async function checkSlackWorkspaceAccess(
  botToken: string
): Promise<void> {
  const { user_id: botUserId } = await callSlackApi<{ user_id: string }>(
    "auth.test",
    botToken
  );
  try {
    await callSlackApi("users.info", botToken, { user: botUserId });
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("missing_scope")) {
      throw new Error(
        "Everyone in the workspace needs the users:read scope. Add it under OAuth & Permissions in the Slack app, reinstall the app, then save again."
      );
    }
    throw error;
  }
}

/** The app id inside an app-level token: `xapp-1-<APP_ID>-...`. */
function slackAppIdFromToken(appToken: string): string | null {
  return appToken.split("-")[2] || null;
}

/**
 * Slack spreads one app's events across all of its Socket Mode connections,
 * so two agents on the same app would each get a random share of the other's
 * messages. The app id is claimed per connection, like a Discord application.
 */
function slackConnectionIdentity(config: SlackConfigFile): string {
  const appId = slackAppIdFromToken(config.appToken);
  return appId ? `app:${appId}` : `bot:${config.botToken}`;
}

export async function saveSlackConfig(
  owner: ChannelOwner,
  input: UpdateSlackSettingsInput
): Promise<SlackSettingsPublic> {
  const existing = await loadSlackConfigFile(owner);
  const botToken = input.botToken?.trim() || existing?.botToken || "";
  const appToken = input.appToken?.trim() || existing?.appToken || "";

  if (!(botToken && appToken)) {
    throw new Error("Bot token and app token are required.");
  }

  const allowedRaw =
    input.allowedUserIds === undefined
      ? (existing?.allowedUserIds.join(",") ?? "")
      : input.allowedUserIds;
  const allowedUserIds = parseSlackUserIds(allowedRaw);
  const next: SlackConfigFile = {
    allowedUserIds,
    allowWorkspace:
      input.allowWorkspace === undefined
        ? (existing?.allowWorkspace ?? false)
        : input.allowWorkspace === true,
    appToken,
    botToken,
    handshakeCode: resolveHandshakeCodeOnSave(existing, allowedUserIds),
    // The dashboard edits one access list (paired + allowed), so a paired
    // member left out of the submitted list loses access too.
    pairedUserIds:
      input.allowedUserIds === undefined
        ? (existing?.pairedUserIds ?? [])
        : (existing?.pairedUserIds ?? []).filter((id) =>
            allowedUserIds.includes(id)
          ),
    profileId: owner.profileId,
  };

  const identity = slackConnectionIdentity(next);
  const rollback = await claimChannelIdentity("slack", owner, identity);
  const appChanged =
    existing !== null && slackConnectionIdentity(existing) !== identity;
  try {
    // Another Slack app means other channels and users: old threads are void.
    if (appChanged) {
      await resetChannelConversationState("slack", owner);
    }
    await writeSlackConfigFile(owner, next);
  } catch (error) {
    await rollback();
    throw error;
  }
  await releaseChannelClaims("slack", owner, identity);
  return toSlackSettingsPublic(next);
}

export async function regenerateSlackHandshake(
  owner: ChannelOwner
): Promise<SlackSettingsPublic> {
  const existing = await loadSlackConfigFile(owner);

  if (!existing) {
    throw new Error("Save the Slack tokens before generating a pairing code.");
  }

  const next = { ...existing, handshakeCode: generateHandshakeCode() };
  await writeSlackConfigFile(owner, next);
  return toSlackSettingsPublic(next);
}

export function verifyAndPairSlackUser(
  owner: ChannelOwner,
  handshakeInput: string,
  userId: string
): Promise<{ ok: boolean; message: string }> {
  return verifyAndPairBotChannelUser<string, SlackConfigFile>({
    handshakeInput,
    isAuthorized: isSlackUserAuthorized,
    label: "Slack",
    load: () => loadSlackConfigFile(owner),
    userId,
    write: (config) => writeSlackConfigFile(owner, config),
  });
}
