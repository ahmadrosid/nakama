import {
  DEFAULT_TELEGRAM_PROFILE_ID,
  getTelegramConfigPath,
  loadTelegramConfigFile,
  resolveTelegramConfigFromSources,
} from "@nakama/core/telegram-config";

export interface TelegramBridgeConfig {
  botToken: string;
  profileId: string;
}

export async function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<TelegramBridgeConfig> {
  const file = await loadTelegramConfigFile();
  const resolved = resolveTelegramConfigFromSources({ env, file });

  if (!resolved) {
    const hasEnvToken = Boolean(env.TELEGRAM_BOT_TOKEN?.trim());

    if (!hasEnvToken && !file) {
      throw new Error(formatNotConfiguredMessage());
    }

    throw new Error(`${formatNotConfiguredMessage()}\n\nMissing: bot token.`);
  }

  return {
    botToken: resolved.botToken,
    profileId: resolved.profileId || DEFAULT_TELEGRAM_PROFILE_ID,
  };
}

function formatNotConfiguredMessage(): string {
  return [
    "Telegram is not configured.",
    "",
    "From the web dashboard:",
    "  1. Run: bun run dev:server  (and bun run dev:web if needed)",
    "  2. Open Integrations → Telegram",
    "  3. Enter your bot token (@BotFather) and profile, then Save",
    "  4. Copy the pairing code, run: bun run dev:telegram",
    "  5. Message your bot and paste the pairing code once",
    "",
    "Or set env var: TELEGRAM_BOT_TOKEN",
    `Config file: ${getTelegramConfigPath()}`,
  ].join("\n");
}
