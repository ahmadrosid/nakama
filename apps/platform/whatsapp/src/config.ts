import type { ChannelOwner } from "@nakama/core/channel-config-shared";
import { loadWhatsAppConfigFile } from "@nakama/core/whatsapp-config";

export interface WhatsAppBridgeConfig {
  orgId?: string | null;
  owner?: ChannelOwner;
  phoneNumber: string;
  profileId: string;
}

export async function loadConfig(
  owner: ChannelOwner
): Promise<WhatsAppBridgeConfig> {
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
