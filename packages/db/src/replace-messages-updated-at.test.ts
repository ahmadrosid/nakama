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
  for (const kind of ["sqlite", "in-memory"] as const) {
    test(`${kind}: summary updatedAt advances past stale message createdAt`, async () => {
      const database =
        kind === "sqlite" ? await createSqliteDatabase(":memory:") : null;
      const adapter = database?.adapter ?? createInMemoryDatabaseAdapter();
      try {
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

        const summaries = await adapter.listSessionSummaries(
          "profile_test",
          "web"
        );
        expect(summaries).toHaveLength(1);
        expect(summaries[0]!.updatedAt > stale).toBe(true);
        expect(summaries[0]!.updatedAt >= beforeReplace).toBe(true);
      } finally {
        database?.close();
      }
    });
  }

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

  test("sqlite: preserves prior messages when a replacement fails", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      await seedSession(database.adapter);
      const createdAt = "2020-06-01T00:00:00.000Z";
      await database.adapter.appendMessagesForSession("session_test", [
        {
          createdAt,
          id: "msg_existing",
          payload: { content: "existing", role: "user" },
          seq: 0,
          sessionId: "session_test",
        },
      ]);

      await expect(
        database.adapter.replaceMessagesForSession("session_test", [
          {
            createdAt,
            id: "msg_duplicate",
            payload: { content: "first", role: "user" },
            seq: 0,
            sessionId: "session_test",
          },
          {
            createdAt,
            id: "msg_duplicate",
            payload: { content: "second", role: "assistant" },
            seq: 1,
            sessionId: "session_test",
          },
        ])
      ).rejects.toThrow();

      expect(
        (await database.adapter.listMessagesForSession("session_test")).map(
          (message) => message.id
        )
      ).toEqual(["msg_existing"]);
    } finally {
      database.close();
    }
  });
});

describe("appendMessagesForSession", () => {
  test("sqlite preserves prior state when a batch fails", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      await seedSession(database.adapter);
      const createdAt = "2020-06-01T00:00:00.000Z";
      await database.adapter.appendMessagesForSession("session_test", [
        {
          createdAt,
          id: "msg_existing",
          payload: { content: "existing", role: "user" },
          seq: 0,
          sessionId: "session_test",
        },
      ]);

      await expect(
        database.adapter.appendMessagesForSession("session_test", [
          {
            createdAt,
            id: "msg_new",
            payload: { content: "new", role: "assistant" },
            seq: 1,
            sessionId: "session_test",
          },
          {
            createdAt,
            id: "msg_existing",
            payload: { content: "duplicate", role: "user" },
            seq: 2,
            sessionId: "session_test",
          },
        ])
      ).rejects.toThrow();

      expect(
        (await database.adapter.listMessagesForSession("session_test")).map(
          (message) => message.id
        )
      ).toEqual(["msg_existing"]);
    } finally {
      database.close();
    }
  });
});
