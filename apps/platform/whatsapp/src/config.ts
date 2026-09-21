import {
  type ChannelOwner,
  channelOwnerFromEnv,
} from "@nakama/core/channel-config-shared";
import { loadWhatsAppConfigFile } from "@nakama/core/whatsapp-config";

export interface WhatsAppBridgeConfig {
  orgId?: string | null;
  owner?: ChannelOwner;
  phoneNumber: string;
  profileId: string;
}

export async function loadConfig(
  env: Record<string, string | undefined> = process.env
): Promise<WhatsAppBridgeConfig> {
  const owner = channelOwnerFromEnv(env);
  const config = await loadWhatsAppConfigFile(owner);
  if (!config) {
    throw new Error(
      "Configure this agent's WhatsApp connection before starting its worker."
    );
  }
  return {
    orgId: owner.orgId,
    owner,
    phoneNumber: config.phoneNumber,
    profileId: owner.profileId,
  };
}
