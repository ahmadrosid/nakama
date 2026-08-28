import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { createSqliteDatabase } from "./adapters/sqlite";
import type { DatabaseAdapter } from "./types";

async function seedSession(adapter: DatabaseAdapter): Promise<void> {
  const now = "2020-01-01T00:00:00.000Z";
  await adapter.upsertOrganization({
    createdAt: now,
    id: "org_test",
    name: "Test",
    slug: "test",
    updatedAt: now,
  });
  await adapter.upsertProfile({
    createdAt: now,
    id: "profile_test",
    isDefault: true,
    isSuper: false,
    model: "provider-1::profile-model",
    name: "Test",
    orgId: "org_test",
    systemPrompt: "Test",
    updatedAt: now,
  });
  await adapter.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: now,
    id: "session_test",
    model: null,
    profileId: "profile_test",
    title: null,
    userId: null,
  });
}

describe("replaceMessagesForSession bumps session updatedAt", () => {
  test("sqlite: summary updatedAt advances past stale message createdAt", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      await seedSession(database.adapter);
      const stale = "2020-06-01T00:00:00.000Z";
      const beforeReplace = new Date().toISOString();

      await database.adapter.replaceMessagesForSession("session_test", [
        {
          createdAt: stale,
          id: "msg_1",
          payload: { content: "hello", role: "user" },
          seq: 0,
          sessionId: "session_test",
        },
      ]);

      const summaries = await database.adapter.listSessionSummaries(
        "profile_test",
        "web"
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.updatedAt > stale).toBe(true);
      expect(summaries[0]!.updatedAt >= beforeReplace).toBe(true);
    } finally {
      database.close();
    }
  });

  test("in-memory: summary updatedAt advances past stale message createdAt", async () => {
    const adapter = createInMemoryDatabaseAdapter();
    await seedSession(adapter);
    const stale = "2020-06-01T00:00:00.000Z";
    const beforeReplace = new Date().toISOString();

    await adapter.replaceMessagesForSession("session_test", [
      {
        createdAt: stale,
        id: "msg_1",
        payload: { content: "hello", role: "user" },
        seq: 0,
        sessionId: "session_test",
      },
    ]);

    const summaries = await adapter.listSessionSummaries("profile_test", "web");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.updatedAt > stale).toBe(true);
    expect(summaries[0]!.updatedAt >= beforeReplace).toBe(true);
  });

  test("sqlite: append after replace does not regress summary updatedAt", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      await seedSession(database.adapter);
      const stale = "2020-06-01T00:00:00.000Z";

      await database.adapter.replaceMessagesForSession("session_test", [
        {
          createdAt: stale,
          id: "msg_1",
          payload: { content: "hello", role: "user" },
          seq: 0,
          sessionId: "session_test",
        },
      ]);

      const afterReplace = (
        await database.adapter.listSessionSummaries("profile_test", "web")
      )[0]!.updatedAt;

      await database.adapter.appendMessagesForSession("session_test", [
        {
          createdAt: stale,
          id: "msg_2",
          payload: { content: "again", role: "user" },
          seq: 1,
          sessionId: "session_test",
        },
      ]);

      const afterAppend = (
        await database.adapter.listSessionSummaries("profile_test", "web")
      )[0]!.updatedAt;

      expect(afterAppend).toBe(afterReplace);
      expect(afterAppend > stale).toBe(true);
    } finally {
      database.close();
    }
  });
});
