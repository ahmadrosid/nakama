/** Optional verbose channel worker logging (user/channel ids and per-message structure). */
export function isChannelDebugEnabled(): boolean {
  return process.env.NAKAMA_CH_DEBUG === "1";
}

/** Discord inbound log line — caller gates with `isChannelDebugEnabled`. */
export function formatDiscordInboundMessageLog(message: {
  author: { id: string };
  channelId: string;
  content?: string | null;
  id: string;
}): string {
  return [
    "[discord] message",
    `messageId=${message.id}`,
    `authorId=${message.author.id}`,
    `channelId=${message.channelId}`,
    `textBytes=${Buffer.byteLength(message.content ?? "", "utf8")}`,
  ].join(" ");
}
