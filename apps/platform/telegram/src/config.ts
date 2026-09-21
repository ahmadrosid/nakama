import {
  type ChannelOwner,
  channelOwnerFromEnv,
} from "@nakama/core/channel-config-shared";
import { loadTelegramConfigFile } from "@nakama/core/telegram-config";

export interface TelegramBridgeConfig {
  botToken: string;
  orgId?: string | null;
  owner?: ChannelOwner;
  profileId: string;
}

async function loadConfig(
  env: Record<string, string | undefined> = process.env
): Promise<TelegramBridgeConfig> {
  const owner = channelOwnerFromEnv(env);
  const config = await loadTelegramConfigFile(owner);
  if (!config) {
    throw new Error(
      "Configure this agent's Telegram connection before starting its worker."
    );
  }
  return {
    botToken: config.botToken,
    orgId: owner.orgId,
    owner,
    profileId: owner.profileId,
  };
}

export async function loadTelegramIdentities(
  env: Record<string, string | undefined> = process.env
): Promise<TelegramBridgeConfig[]> {
  return [await loadConfig(env)];
}
