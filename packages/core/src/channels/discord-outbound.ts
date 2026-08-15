import { DISCORD_API_BASE_URL, loadDiscordConfigFile } from "../discord-config";
import { splitTelegramChunks } from "./message-format";
import type { ChannelSendResult, DiscordOutboundAdapter } from "./types";

const DISCORD_MESSAGE_MAX_LENGTH = 2000;
const DISCORD_USER_AGENT =
  "DiscordBot (https://github.com/ahmadrosid/nakama, 1.0)";
const DISCORD_ALLOWED_MENTIONS = { parse: [] as string[] };

export interface DiscordOutboundOptions {
  fetchImpl?: typeof fetch;
}

function discordHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": DISCORD_USER_AGENT,
  };
}

export function createDiscordOutboundAdapter(
  options: DiscordOutboundOptions = {}
): DiscordOutboundAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(input): Promise<ChannelSendResult> {
      try {
        const config = await loadDiscordConfigFile();
        const token = config?.botToken.trim();

        if (!token) {
          return { error: "Discord bot token is not configured.", ok: false };
        }

        const chunks = splitTelegramChunks(
          input.text,
          DISCORD_MESSAGE_MAX_LENGTH
        );

        if (chunks.length === 0) {
          return { error: "Message text is empty.", ok: false };
        }

        const channelId = input.channelId?.trim();

        if (channelId) {
          return sendChunksToChannel(fetchImpl, token, channelId, chunks);
        }

        const userIds = config?.pairedUserIds ?? [];

        if (userIds.length === 0) {
          return { error: "No Discord user is paired.", ok: false };
        }

        for (const userId of userIds) {
          const dm = await openDmChannel(fetchImpl, token, userId);

          if (!dm.ok) {
            return dm;
          }

          const sent = await sendChunksToChannel(
            fetchImpl,
            token,
            dm.channelId,
            chunks
          );

          if (!sent.ok) {
            return sent;
          }
        }

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, ok: false };
      }
    },
  };
}

async function openDmChannel(
  fetchImpl: typeof fetch,
  token: string,
  recipientId: string
): Promise<{ ok: true; channelId: string } | ChannelSendResult> {
  const response = await fetchImpl(
    `${DISCORD_API_BASE_URL}/users/@me/channels`,
    {
      body: JSON.stringify({ recipient_id: recipientId }),
      headers: discordHeaders(token),
      method: "POST",
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return {
      error: `Discord API error (${response.status}): ${body.slice(0, 200)}`,
      ok: false,
    };
  }

  const payload = (await response.json()) as { id?: unknown };

  if (typeof payload.id !== "string" || !payload.id) {
    return {
      error: "Discord DM channel response was missing an id.",
      ok: false,
    };
  }

  return { channelId: payload.id, ok: true };
}

async function sendChunksToChannel(
  fetchImpl: typeof fetch,
  token: string,
  channelId: string,
  chunks: string[]
): Promise<ChannelSendResult> {
  for (const chunk of chunks) {
    const response = await fetchImpl(
      `${DISCORD_API_BASE_URL}/channels/${channelId}/messages`,
      {
        body: JSON.stringify({
          allowed_mentions: DISCORD_ALLOWED_MENTIONS,
          content: chunk,
        }),
        headers: discordHeaders(token),
        method: "POST",
      }
    );

    if (!response.ok) {
      const body = await response.text();
      return {
        error: `Discord API error (${response.status}): ${body.slice(0, 200)}`,
        ok: false,
      };
    }
  }

  return { ok: true };
}
