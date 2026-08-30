/** Optional verbose channel worker logging (user/channel ids). */
export function isChannelDebugEnabled(): boolean {
  return process.env.NAKAMA_CH_DEBUG === "1";
}

/** Default Discord inbound log line — no user/channel ids unless debug. */
export function formatDiscordInboundMessageLog(message: {
  author: { id: string };
  channelId: string;
  content?: string | null;
  id: string;
}): string {
  return [
    "[discord] message",
    `messageId=${message.id}`,
    ...(isChannelDebugEnabled()
      ? [`authorId=${message.author.id}`, `channelId=${message.channelId}`]
      : []),
    `textBytes=${Buffer.byteLength(message.content ?? "", "utf8")}`,
  ].join(" ");
}
