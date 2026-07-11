import {
  DEFAULT_DISCORD_PROFILE_ID,
  getDiscordConfigPath,
  loadDiscordConfigFile,
  resolveDiscordConfigFromSources,
} from "@nakama/core/discord-config";

export interface DiscordBridgeConfig {
  botToken: string;
  profileId: string;
}

export async function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<DiscordBridgeConfig> {
  const file = await loadDiscordConfigFile();
  const resolved = resolveDiscordConfigFromSources({ env, file });

  if (!resolved) {
    const hasEnvToken = Boolean(env.DISCORD_BOT_TOKEN?.trim());

    if (!hasEnvToken && !file) {
      throw new Error(formatNotConfiguredMessage());
    }

    throw new Error(`${formatNotConfiguredMessage()}\n\nMissing: bot token.`);
  }

  return {
    botToken: resolved.botToken,
    profileId: resolved.profileId || DEFAULT_DISCORD_PROFILE_ID,
  };
}

function formatNotConfiguredMessage(): string {
  return [
    "Discord is not configured.",
    "",
    "From the web dashboard:",
    "  1. Run: bun run dev:server  (and bun run dev:web if needed)",
    "  2. Open Integrations → Discord",
    "  3. Enter your bot token and profile, then Save",
    "  4. Copy the pairing code, run: bun run dev:discord",
    "  5. DM your bot and paste the pairing code once",
    "",
    "Or set env var: DISCORD_BOT_TOKEN",
    `Config file: ${getDiscordConfigPath()}`,
  ].join("\n");
}
