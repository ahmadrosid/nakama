import {
  DEFAULT_TELEGRAM_PROFILE_ID,
  getTelegramConfigPath,
  listTelegramConfigOrgIds,
  loadTelegramConfigFile,
  resolveTelegramConfigFromSources,
  type TelegramConfigScope,
} from "@nakama/core/telegram-config";

export interface TelegramBridgeConfig {
  botToken: string;
  /** Org that owns this bot, or null for the install-wide config. */
  orgId: TelegramConfigScope;
  profileId: string;
}

/**
 * Every identity this install should run: the install-wide config plus one per
 * org that saved its own. Ordered so the install-wide bot keeps its place.
 */
export async function loadTelegramIdentities(
  env: Record<string, string | undefined> = process.env
): Promise<TelegramBridgeConfig[]> {
  const scopes: TelegramConfigScope[] = [
    null,
    ...(await listTelegramConfigOrgIds()),
  ];
  const identities: TelegramBridgeConfig[] = [];

  for (const scope of scopes) {
    const config = await loadConfigOrNull(scope, env);

    if (config) {
      identities.push(config);
    }
  }

  if (identities.length === 0) {
    throw new Error(formatNotConfiguredMessage());
  }

  return identities;
}

async function loadConfigOrNull(
  orgId: TelegramConfigScope,
  env: Record<string, string | undefined>
): Promise<TelegramBridgeConfig | null> {
  const file = await loadTelegramConfigFile(orgId);
  // TELEGRAM_BOT_TOKEN is an install-wide override, so it must not leak into an
  // org's identity and give two scopes the same token.
  const resolved = resolveTelegramConfigFromSources({
    env: orgId === null ? env : {},
    file,
  });

  if (!resolved) {
    return null;
  }

  return {
    botToken: resolved.botToken,
    orgId,
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
    `Config file: ${getTelegramConfigPath(null)}`,
  ].join("\n");
}
