import type { DiscordConfigFile } from "@nakama/core/discord-config";
import {
  isDiscordUserAuthorized,
  loadDiscordConfigFile,
  verifyAndPairDiscordUser,
} from "@nakama/core/discord-config";

export class DiscordAuthStore {
  private config: DiscordConfigFile | null = null;

  async reload(): Promise<DiscordConfigFile | null> {
    this.config = await loadDiscordConfigFile();
    return this.config;
  }

  getConfig(): DiscordConfigFile | null {
    return this.config;
  }

  isAuthorized(userId: string): boolean {
    if (!this.config) {
      return false;
    }

    return isDiscordUserAuthorized(userId, this.config);
  }

  /** Paired bridge owners — admin for Discord bot management commands. */
  isPaired(userId: string): boolean {
    return this.config?.pairedUserIds.includes(userId) ?? false;
  }

  async tryPair(
    handshakeInput: string,
    userId: string
  ): Promise<{ ok: boolean; message: string }> {
    const result = await verifyAndPairDiscordUser(handshakeInput, userId);
    await this.reload();
    return result;
  }
}
