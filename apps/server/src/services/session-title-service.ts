import { generateSessionTitleFromMessages } from "@nakama/agent";
import type { ChatMessage, UserConfig } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { createProviderForProfile } from "./provider-instance-helpers";

export const SESSION_TITLE_FALLBACK = "Untitled";

export class SessionTitleService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly getUserConfig: () => UserConfig | null
  ) {}

  scheduleSessionTitleGeneration(sessionId: string): void {
    void this.generateSessionTitle(sessionId).catch((error) => {
      console.error(
        `Failed to generate session title for ${sessionId}:`,
        error
      );
    });
  }

  private async generateSessionTitle(sessionId: string): Promise<void> {
    if (this.inFlight.has(sessionId)) {
      return;
    }

    this.inFlight.add(sessionId);

    try {
      const session = await this.db.getSession(sessionId);

      if (!session || session.title !== null) {
        return;
      }

      const storedMessages = await this.db.listMessagesForSession(sessionId);
      const messages = storedMessages.map(
        (record) => record.payload as ChatMessage
      );

      if (!hasCompletedFirstTurn(messages)) {
        return;
      }

      const provider = await createProviderForProfile(
        this.db,
        session.profileId,
        this.getUserConfig()
      );

      if (!provider) {
        await this.db.updateSessionTitle(sessionId, SESSION_TITLE_FALLBACK);
        return;
      }

      const title = await generateSessionTitleFromMessages(messages, {
        provider,
      });

      await this.db.updateSessionTitle(
        sessionId,
        title ?? SESSION_TITLE_FALLBACK
      );
    } finally {
      this.inFlight.delete(sessionId);
    }
  }
}

function hasCompletedFirstTurn(messages: readonly ChatMessage[]): boolean {
  const hasUser = messages.some((message) => message.role === "user");
  const hasAssistant = messages.some(
    (message) =>
      message.role === "assistant" && message.content.trim().length > 0
  );

  return hasUser && hasAssistant;
}
