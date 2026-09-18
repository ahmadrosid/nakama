import { describe, expect, test } from "bun:test";
import { createSqliteDatabase } from "./adapters/sqlite";

describe("SQLite session model persistence", () => {
  test("stores, updates, and clears a session model override", async () => {
    const database = await createSqliteDatabase(":memory:");
    const now = new Date().toISOString();

    try {
      await database.adapter.upsertOrganization({
        createdAt: now,
        id: "org_test",
        name: "Test",
        slug: "test",
        updatedAt: now,
      });
      await database.adapter.upsertProfile({
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
      await database.adapter.upsertSession({
        agentQuestionnaire: null,
        agentTodos: [],
        channel: "web",
        createdAt: now,
        id: "session_test",
        model: "provider-1::chat-model",
        profileId: "profile_test",
        title: null,
        userId: null,
      });

      expect((await database.adapter.getSession("session_test"))?.model).toBe(
        "provider-1::chat-model"
      );

      expect(
        await database.adapter.updateSessionModel(
          "session_test",
          "provider-1::next-model"
        )
      ).toBe(true);
      expect((await database.adapter.getSession("session_test"))?.model).toBe(
        "provider-1::next-model"
      );

      expect(
        await database.adapter.updateSessionModel("session_test", null)
      ).toBe(true);
      expect(
        (await database.adapter.getSession("session_test"))?.model
      ).toBeNull();
      expect(
        await database.adapter.renameSessionTitle(
          "session_test",
          "Renamed chat"
        )
      ).toBe(true);
      expect(
        await database.adapter.updateSessionPinned("session_test", true)
      ).toBe(true);
      expect(await database.adapter.getSession("session_test")).toMatchObject({
        pinned: true,
        title: "Renamed chat",
      });
    } finally {
      database.close();
    }
  });
});
