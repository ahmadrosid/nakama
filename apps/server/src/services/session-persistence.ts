import type { AgentChatSession } from "@tinyclaw/agent";
import type { ChatMessage } from "@tinyclaw/core";
import { createId } from "@tinyclaw/core";
import type { DatabaseAdapter } from "@tinyclaw/db";

export function wrapPersistedSession(
  sessionId: string,
  session: AgentChatSession,
  db: DatabaseAdapter,
): AgentChatSession {
  return {
    async send(message) {
      const before = session.getHistory().length;
      const reply = await session.send(message);
      await persistHistoryDelta(db, sessionId, session.getHistory(), before);
      return reply;
    },
    async sendStream(message, handlers) {
      const before = session.getHistory().length;
      const reply = await session.sendStream(message, handlers);
      await persistHistoryDelta(db, sessionId, session.getHistory(), before);
      return reply;
    },
    clear() {
      session.clear();
      void db.deleteMessagesForSession(sessionId);
    },
    getHistory: () => session.getHistory(),
    createAutomation: (prompt) => session.createAutomation(prompt),
  };
}

export async function loadSessionHistory(
  db: DatabaseAdapter,
  sessionId: string,
): Promise<ChatMessage[]> {
  const storedMessages = await db.listMessagesForSession(sessionId);

  return storedMessages.map((record) => record.payload as ChatMessage);
}

async function persistHistoryDelta(
  db: DatabaseAdapter,
  sessionId: string,
  history: readonly ChatMessage[],
  previousLength: number,
): Promise<void> {
  if (history.length <= previousLength) {
    return;
  }

  const existing = await db.listMessagesForSession(sessionId);
  const nextSeq =
    existing.length > 0
      ? Math.max(...existing.map((record) => record.seq)) + 1
      : 0;
  const now = new Date().toISOString();
  const newMessages = history.slice(previousLength).map((payload, index) => ({
    id: createId("msg"),
    sessionId,
    seq: nextSeq + index,
    payload,
    createdAt: now,
  }));

  await db.appendMessagesForSession(sessionId, newMessages);
}
