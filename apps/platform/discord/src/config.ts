import {
  type ChannelOwner,
  channelOwnerFromEnv,
} from "@nakama/core/channel-config-shared";
import { loadDiscordConfigFile } from "@nakama/core/discord-config";

export interface DiscordBridgeConfig {
  botToken: string;
  orgId?: string | null;
  owner?: ChannelOwner;
  profileId: string;
}

export async function loadConfig(
  env: Record<string, string | undefined> = process.env
): Promise<DiscordBridgeConfig> {
  const owner = channelOwnerFromEnv(env);
  const config = await loadDiscordConfigFile(owner);
  if (!config) {
    throw new Error(
      "Configure this agent's Discord connection before starting its worker."
    );
  }
  return {
    botToken: config.botToken,
    orgId: owner.orgId,
    owner,
    profileId: owner.profileId,
  };
}
