import type { AgentChatSession } from "@nakama/agent";
import type { ChatMessage } from "@nakama/core";
import { createId } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";

export function wrapPersistedSession(
  sessionId: string,
  session: AgentChatSession,
  db: DatabaseAdapter,
  options: { onBeginTurn?: (sessionId: string) => void } = {},
): AgentChatSession {
  let lastPersistedRevision = session.getHistoryRevision();

  return {
    async send(message) {
      options.onBeginTurn?.(sessionId);
      const before = session.getHistory().length;
      const revisionBefore = session.getHistoryRevision();
      const reply = await session.send(message);
      await persistSessionHistory(db, sessionId, session, before, revisionBefore, lastPersistedRevision);
      lastPersistedRevision = session.getHistoryRevision();
      return reply;
    },
    async sendStream(message, handlers) {
      options.onBeginTurn?.(sessionId);
      const before = session.getHistory().length;
      const revisionBefore = session.getHistoryRevision();
      const reply = await session.sendStream(message, handlers);
      await persistSessionHistory(db, sessionId, session, before, revisionBefore, lastPersistedRevision);
      lastPersistedRevision = session.getHistoryRevision();
      return reply;
    },
    clear() {
      session.clear();
      lastPersistedRevision = session.getHistoryRevision();
      void db.deleteMessagesForSession(sessionId);
    },
    async compact(options) {
      const revisionBefore = session.getHistoryRevision();
      const result = await session.compact(options);
      if (session.getHistoryRevision() > revisionBefore) {
        await replaceSessionHistory(db, sessionId, session.getHistory());
        lastPersistedRevision = session.getHistoryRevision();
      }
      return result;
    },
    getHistory: () => session.getHistory(),
    getHistoryRevision: () => session.getHistoryRevision(),
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

export async function replaceSessionHistory(
  db: DatabaseAdapter,
  sessionId: string,
  history: readonly ChatMessage[],
): Promise<void> {
  const now = new Date().toISOString();
  const messages = history.map((payload, index) => ({
    id: createId("msg"),
    sessionId,
    seq: index,
    payload,
    createdAt: now,
  }));

  await db.replaceMessagesForSession(sessionId, messages);
}

async function persistSessionHistory(
  db: DatabaseAdapter,
  sessionId: string,
  session: AgentChatSession,
  previousLength: number,
  revisionBefore: number,
  lastPersistedRevision: number,
): Promise<void> {
  const history = session.getHistory();

  if (session.getHistoryRevision() > revisionBefore || session.getHistoryRevision() > lastPersistedRevision) {
    await replaceSessionHistory(db, sessionId, history);
    return;
  }

  await persistHistoryDelta(db, sessionId, history, previousLength);
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
