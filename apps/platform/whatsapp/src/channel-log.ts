/** Optional verbose channel worker logging (per-message structural info). */
export function isChannelDebugEnabled(): boolean {
  return process.env.NAKAMA_CH_DEBUG === "1";
}
