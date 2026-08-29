/** Optional verbose channel worker logging (user/channel ids). */
export function isChannelDebugEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.NAKAMA_CH_DEBUG === "1";
}

/** Default Discord inbound log line — no user/channel ids unless debug. */
export function formatDiscordInboundMessageLog(message: {
  author: { id: string };
  channelId: string;
  content?: string | null;
  id: string;
}): string {
  const parts = [
    "[discord] message",
    `messageId=${message.id}`,
    `textBytes=${Buffer.byteLength(message.content ?? "", "utf8")}`,
  ];
  if (isChannelDebugEnabled()) {
    parts.splice(
      2,
      0,
      `authorId=${message.author.id}`,
      `channelId=${message.channelId}`
    );
  }
  return parts.join(" ");
}
