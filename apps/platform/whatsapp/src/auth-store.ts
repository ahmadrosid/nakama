import type { WhatsAppConfigFile } from "@nakama/core/whatsapp-config";
import {
  isWhatsAppUserAuthorized,
  loadWhatsAppConfigFile,
  verifyAndPairWhatsAppUser,
} from "@nakama/core/whatsapp-config";

export class WhatsAppAuthStore {
  private config: WhatsAppConfigFile | null = null;

  async reload(): Promise<WhatsAppConfigFile | null> {
    this.config = await loadWhatsAppConfigFile();
    return this.config;
  }

  getConfig(): WhatsAppConfigFile | null {
    return this.config;
  }

  isAuthorized(jid: string): boolean {
    if (!this.config) {
      return false;
    }

    return isWhatsAppUserAuthorized(jid, this.config);
  }

  async tryPair(
    pairingCodeInput: string,
    jid: string,
  ): Promise<{ ok: boolean; message: string }> {
    const result = await verifyAndPairWhatsAppUser(pairingCodeInput, jid);
    await this.reload();
    return result;
  }
}