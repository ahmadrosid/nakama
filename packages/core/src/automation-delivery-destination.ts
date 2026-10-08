import { NakamaApiError } from "./api-error";
import type { OrgRole } from "./contract";
import { DISCORD_API_BASE_URL, DISCORD_USER_AGENT } from "./discord-config";
import { isTelegramUserAuthorized } from "./telegram-config";
import { z } from "zod";

const TelegramChatResponseSchema = z.object({
  result: z.object({
    permissions: z.object({ can_send_messages: z.boolean().optional() }).nullish(),
  }).nullish(),
});

const DiscordUserResponseSchema = z.object({ id: z.string().min(1) });

const DiscordPermissionsResponseSchema = z.object({
  permissions: z.union([z.string(), z.number()]).optional(),
});

const PermissionBitsSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.number(),
]).refine((bits) => Number.isSafeInteger(bits) && bits >= 0);

/**
 * Caller identity used to decide who may pin automation output to a concrete
 * Telegram chat or Discord channel instead of the paired/allowlisted set.
 */
export interface AutomationDeliveryAccess {
  isPlatformAdmin?: boolean;
  orgRole?: OrgRole | null;
}

/** Discord permission bits an automation destination needs: view it, then post. */
const DISCORD_VIEW_CHANNEL = 1024;

const DISCORD_SEND_MESSAGES = 2048;

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

/**
 * Only an org admin (or a platform admin) can widen delivery beyond the
 * paired/allowlisted conversations. Missing access context is treated as a
 * non-admin caller so internal callers fail closed.
 */
export function canApproveAutomationDeliveryDestination(
  access?: AutomationDeliveryAccess
): boolean {
  return access?.isPlatformAdmin === true || access?.orgRole === "admin";
}

/**
 * A Telegram chat id is only ever a paired or allowlisted user id: a one-to-one
 * chat's id equals the user's id, and group/supergroup ids are negative, so no
 * member can smuggle a group through this check.
 */
export function isTelegramDeliveryChatAuthorized(
  chatId: number,
  config: { allowedUserIds: number[]; pairedUserIds: number[] }
): boolean {
  return isTelegramUserAuthorized(chatId, config);
}

export function automationDeliveryDestinationForbidden(
  channel: "Discord" | "Telegram"
): NakamaApiError {
  return new NakamaApiError(
    `Ask an organization admin to approve this ${channel} destination. Members can only send automation results to their own paired conversations.`,
    403
  );
}

async function readErrorSummary(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return response.statusText;
  }
}

/**
 * Provider-side check that the bot may actually post in the chat, so an admin
 * cannot pin delivery to a chat the organization bot has no access to.
 */
export async function assertTelegramBotCanPostToChat(options: {
  botToken: string;
  chatId: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(
    `${TELEGRAM_API_BASE_URL}/bot${options.botToken}/getChat?chat_id=${options.chatId}`
  );

  if (!response.ok) {
    throw new NakamaApiError(
      `Telegram chat ${options.chatId} is not reachable by the configured bot.`,
      400
    );
  }

  // The Bot API wraps the chat in an `ok`/`result` envelope.
  const json = await response.json().catch(() => null);
  const payload = TelegramChatResponseSchema.safeParse(json);

  if (payload.success && payload.data.result?.permissions?.can_send_messages === false) {
    throw new NakamaApiError(
      `The configured Telegram bot cannot post in chat ${options.chatId}.`,
      400
    );
  }
}

async function resolveDiscordBotId(
  botToken: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/users/@me`, {
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": DISCORD_USER_AGENT,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = DiscordUserResponseSchema.safeParse(
    await response.json().catch(() => null)
  );

  return payload.success ? payload.data.id : null;
}

/**
 * Provider-side check that the organization bot can view and post in the
 * channel, so an admin-approved destination is still a usable one.
 */
export async function assertDiscordBotCanPostToChannel(options: {
  botToken: string;
  channelId: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const botId = await resolveDiscordBotId(options.botToken, fetchImpl);

  if (!botId) {
    throw new NakamaApiError(
      "Could not verify the Discord bot for this channel. Check the Discord integration.",
      400
    );
  }

  const response = await fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${options.channelId}/permissions/${botId}`,
    {
      headers: {
        Authorization: `Bot ${options.botToken}`,
        "User-Agent": DISCORD_USER_AGENT,
      },
    }
  );

  if (!response.ok) {
    throw new NakamaApiError(
      `Discord channel ${options.channelId} is not reachable by the configured bot (${response.status}: ${await readErrorSummary(response)}).`,
      400
    );
  }

  const payload = DiscordPermissionsResponseSchema.safeParse(
    await response.json().catch(() => null)
  );

  const granted = payload.success
    ? toPermissionBits(payload.data.permissions)
    : null;

  if (
    granted === null ||
    !hasDiscordPermission(granted, DISCORD_VIEW_CHANNEL) ||
    !hasDiscordPermission(granted, DISCORD_SEND_MESSAGES)
  ) {
    throw new NakamaApiError(
      `The configured Discord bot cannot post in channel ${options.channelId}.`,
      400
    );
  }
}

/** Discord sends permissions as a decimal bitfield; every bit fits a double. */
function hasDiscordPermission(granted: number, permission: number): boolean {
  return Math.trunc(granted / permission) % 2 === 1;
}

function toPermissionBits(value: string | number | undefined): number | null {
  const parsed = PermissionBitsSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}
