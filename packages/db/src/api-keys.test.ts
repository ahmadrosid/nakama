import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase } from "./adapters/sqlite";
import { migrateDatabase } from "./migrate";

test("upgrades remove key storage idempotently and retain private session markers", () => {
  const db = new Database(":memory:");

  try {
    migrateDatabase(db);
    db.exec(
      "CREATE TABLE api_keys (secret_hash TEXT); INSERT INTO api_keys VALUES ('old-secret')"
    );
    db.exec(
      "INSERT INTO organizations (id,name,slug,created_at,updated_at) VALUES ('o','Org','o','now','now')"
    );
    db.exec(
      "INSERT INTO profiles (id,name,org_id,created_at,updated_at) VALUES ('p','Profile','o','now','now')"
    );
    db.exec(
      "INSERT INTO sessions (id,profile_id,channel,app_user_id,created_at,updated_at) VALUES ('private','p','web','alice','now','now')"
    );
    migrateDatabase(db);
    migrateDatabase(db);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name = 'api_keys'").get()
    ).toBeNull();
    expect(
      db.query("SELECT app_user_id FROM sessions WHERE id='private'").get()
    ).toEqual({ app_user_id: "alice" });
  } finally {
    db.close();
  }
});

test("retired sessions cannot be read, paged, mutated or resurrected, including attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "retired-sessions-"));
  const filename = join(root, "nakama.sqlite");
  const database = await createSqliteDatabase(`file:${filename}`);
  const raw = new Database(filename);
  const db = database.adapter;

  try {
    raw.exec(
      "INSERT INTO organizations (id,name,slug,created_at,updated_at) VALUES ('o','Org','o','now','now')"
    );
    raw.exec(
      "INSERT INTO profiles (id,name,org_id,created_at,updated_at) VALUES ('p','Profile','o','now','now')"
    );
    raw.exec(
      "INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ('u','test@example.com','unused','now','now')"
    );

    for (const [id, marker] of [
      ["private", "alice"],
      ["empty-marker", ""],
      ["normal", null],
    ] as const) {
      raw
        .query(
          "INSERT INTO sessions (id,profile_id,channel,app_user_id,user_id,created_at,updated_at,title) VALUES (?,'p','web',?,'u','now','now',?)"
        )
        .run(id, marker, id);
      raw
        .query(
          "INSERT INTO session_messages (id,session_id,seq,payload,created_at) VALUES (?,?,0,?, 'now')"
        )
        .run(`msg-${id}`, id, JSON.stringify({ content: id, role: "user" }));
      raw
        .query(
          "INSERT INTO attachments (id,org_id,profile_id,session_id,channel,kind,media_type,size_bytes,storage_path,created_at) VALUES (?,'o','p',?,'web','image','image/png',1,?,'now')"
        )
        .run(`att-${id}`, id, id);
    }

    raw.exec(
      "INSERT INTO attachments (id,org_id,profile_id,session_id,channel,kind,media_type,size_bytes,storage_path,created_at,ephemeral) VALUES ('ephemeral','o','p',NULL,'web','image','image/png',1,'ephemeral','now',1)"
    );
    expect((await db.listSessions()).map((s) => s.id)).toEqual(["normal"]);
    expect((await db.listSessionsForUser("u")).map((s) => s.id)).toEqual([
      "normal",
    ]);
    expect(
      (
        await db.listSessionSummaries("p", ["web"], { limit: 1, orgId: "o" })
      ).map((s) => s.id)
    ).toEqual(["normal"]);
    expect(
      await db.listSessionSummaries("p", ["web"], {
        orgId: "o",
        query: "private",
      })
    ).toEqual([]);

    for (const id of ["private", "empty-marker"]) {
      expect(await db.getSession(id)).toBeNull();
      expect(await db.listMessagesForSession(id)).toEqual([]);
      expect(await db.getSessionTodos(id)).toEqual([]);
      expect(await db.getSessionQuestionnaire(id)).toBeNull();
      expect(await db.getAttachment(`att-${id}`)).toBeNull();
      expect(await db.listAttachmentsForSession(id)).toEqual([]);
      expect(await db.deleteAttachment(`att-${id}`)).toBe(false);
      expect(await db.updateSessionModel(id, "changed")).toBe(false);
      expect(await db.renameSessionTitle(id, "changed")).toBe(false);
      expect(await db.updateSessionPinned(id, true)).toBe(false);
      await db.updateSessionTodos(id, []);
      await db.updateSessionQuestionnaire(id, null);
      await expect(db.replaceMessagesForSession(id, [])).rejects.toThrow();
      await expect(
        db.appendMessagesForSession(id, [
          { createdAt: "now", id: "new", payload: {}, seq: 1, sessionId: id },
        ])
      ).rejects.toThrow();
      await expect(
        db.upsertSession({
          agentQuestionnaire: null,
          agentTodos: [],
          channel: "web",
          createdAt: "now",
          id,
          model: null,
          profileId: "p",
          title: null,
        })
      ).rejects.toThrow();
      expect(await db.deleteSession(id)).toBe(false);
      expect(
        raw.query("SELECT title FROM sessions WHERE id=?").get(id)
      ).toEqual({ title: id });
      expect(
        raw
          .query(
            "SELECT count(*) AS n FROM session_messages WHERE session_id=?"
          )
          .get(id)
      ).toEqual({ n: 1 });
    }

    expect(await db.getAttachment("att-normal")).not.toBeNull();
    expect((await db.listEphemeralAttachments()).map((a) => a.id)).toEqual([
      "ephemeral",
    ]);
    expect(await db.getAttachment("ephemeral")).not.toBeNull();
  } finally {
    raw.close(true);
    database.release();
    await rm(root, { force: true, recursive: true });
  }
});
