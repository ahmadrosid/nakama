import type {
  TelegramConfigFile,
  TelegramConfigScope,
} from "@nakama/core/telegram-config";
import {
  isTelegramUserAuthorized,
  loadTelegramConfigFile,
  verifyAndPairTelegramUser,
} from "@nakama/core/telegram-config";

export class TelegramAuthStore {
  private config: TelegramConfigFile | null = null;

  constructor(private readonly orgId: TelegramConfigScope) {}

  async reload(): Promise<TelegramConfigFile | null> {
    this.config = await loadTelegramConfigFile(this.orgId);
    return this.config;
  }

  getConfig(): TelegramConfigFile | null {
    return this.config;
  }

  isAuthorized(userId: number): boolean {
    if (!this.config) {
      return false;
    }

    return isTelegramUserAuthorized(userId, this.config);
  }

  async tryPair(
    handshakeInput: string,
    userId: number
  ): Promise<{ ok: boolean; message: string }> {
    const result = await verifyAndPairTelegramUser(
      this.orgId,
      handshakeInput,
      userId
    );
    await this.reload();
    return result;
  }
}
