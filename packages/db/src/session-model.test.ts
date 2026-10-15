import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("writes the profile org on insert and follows a profile move on re-upsert", async () => {
    const root = mkdtempSync(join(tmpdir(), "session-org-"));
    const filename = join(root, "nakama.sqlite");
    const database = await createSqliteDatabase(`file:${filename}`);
    const raw = new Database(filename);
    const now = new Date().toISOString();

    try {
      const org = (id: string) =>
        database.adapter.upsertOrganization({
          createdAt: now,
          id,
          name: `Org ${id}`,
          slug: `org-${id}`,
          updatedAt: now,
        });

      const profile = (id: string, orgId: string) =>
        database.adapter.upsertProfile({
          createdAt: now,
          id,
          isDefault: false,
          isSuper: false,
          model: null,
          name: `Profile ${id}`,
          orgId,
          systemPrompt: "Test",
          updatedAt: now,
        });

      await org("org_a");

      await org("org_b");

      await profile("profile_org_a", "org_a");

      await profile("profile_org_b", "org_b");

      const record = {
        agentQuestionnaire: null,
        agentTodos: [],
        channel: "web",
        createdAt: now,
        id: "session_test",
        model: "provider-1::chat-model",
        profileId: "profile_org_a",
        title: null,
        userId: null,
      };

      await database.adapter.upsertSession(record);

      expect(
        raw.query("SELECT org_id FROM sessions WHERE id = 'session_test'").get()
      ).toEqual({ org_id: "org_a" });

      await database.adapter.upsertSession(record);

      expect(
        raw.query("SELECT org_id FROM sessions WHERE id = 'session_test'").get()
      ).toEqual({ org_id: "org_a" });

      await database.adapter.upsertSession({
        ...record,
        profileId: "profile_org_b",
      });

      expect(
        raw
          .query(
            "SELECT profile_id, org_id FROM sessions WHERE id = 'session_test'"
          )
          .get()
      ).toEqual({ org_id: "org_b", profile_id: "profile_org_b" });
    } finally {
      raw.close(true);
      database.release();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
