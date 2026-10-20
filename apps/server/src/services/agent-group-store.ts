import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getOrgConfigDir } from "@nakama/core";
import type {
  AgentGroup,
  AgentGroupMessage,
  AgentGroupSession,
} from "@nakama/core/agent-groups";

const SCHEMA = `PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
    member_ids TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS group_sessions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS group_sessions_group ON group_sessions (group_id, updated_at);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES group_sessions (id) ON DELETE CASCADE,
    author_profile_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_session ON messages (session_id, id);
  CREATE TABLE IF NOT EXISTS group_avatars (
    group_id TEXT PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
    media_type TEXT NOT NULL, bytes BLOB NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS rail_pins (
    user_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (user_id, item_id));`;

const GROUP_COLUMNS = `g.id, g.name, g.member_ids, g.created_at, a.updated_at AS avatar_version
  FROM groups g LEFT JOIN group_avatars a ON a.group_id = g.id`;

// Joined to groups so every session read is scoped to the group's owner.
const SESSION_COLUMNS = `s.id, s.group_id, s.title, s.pinned, s.created_at, s.updated_at
  FROM group_sessions s JOIN groups g ON g.id = s.group_id`;

interface GroupRow {
  avatar_version: string | null;
  created_at: string;
  id: string;
  member_ids: string;
  name: string;
}

interface SessionRow {
  created_at: string;
  group_id: string;
  id: string;
  pinned: number;
  title: string;
  updated_at: string;
}

interface MessageRow {
  author_profile_id: string | null;
  content: string;
  created_at: string;
  id: number;
}

/** A stored session; `active` belongs to the in-memory run state. */
export type StoredGroupSession = Omit<AgentGroupSession, "active">;

// One open handle per org file, so polling does not reopen it and the schema
// runs once. Keyed by path, which follows the config dir.
const databases = new Map<string, Database>();

function withGroupDb<T>(orgId: string, run: (db: Database) => T): T {
  const directory = getOrgConfigDir(orgId);
  const path = join(directory, "agent-groups.sqlite");
  let db = databases.get(path);

  if (!db) {
    mkdirSync(directory, { mode: 0o700, recursive: true });
    db = new Database(path);

    try {
      chmodSync(path, 0o600);
      db.exec(SCHEMA);
    } catch (error) {
      db.close();
      throw error;
    }

    databases.set(path, db);
  }

  return run(db);
}

/**
 * Closes every group database, for a data restore: Windows cannot move an
 * open file, and a handle kept across the swap would still point at the old
 * one. The next call reopens what is on disk.
 */
export function closeAgentGroupDatabases(): void {
  for (const db of databases.values()) {
    db.close();
  }

  databases.clear();
}

function toGroup(row: GroupRow): AgentGroup {
  // SAFETY: member_ids is only ever written by this store as a JSON string array.
  const memberIds = JSON.parse(row.member_ids) as string[];

  return {
    avatarVersion: row.avatar_version,
    createdAt: row.created_at,
    id: row.id,
    memberIds,
    name: row.name,
  };
}

function toSession(row: SessionRow): StoredGroupSession {
  return {
    createdAt: row.created_at,
    groupId: row.group_id,
    id: row.id,
    pinned: row.pinned === 1,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): AgentGroupMessage {
  return {
    authorProfileId: row.author_profile_id,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
  };
}

export function listAgentGroups(orgId: string, ownerId: string): AgentGroup[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<GroupRow, [string]>(
        `SELECT ${GROUP_COLUMNS} WHERE g.owner_user_id = ? ORDER BY g.created_at DESC`
      )
      .all(ownerId)
      .map(toGroup)
  );
}

export function getAgentGroup(
  orgId: string,
  ownerId: string,
  groupId: string
): AgentGroup | null {
  const row = withGroupDb(orgId, (db) =>
    db
      .query<GroupRow, [string, string]>(
        `SELECT ${GROUP_COLUMNS} WHERE g.id = ? AND g.owner_user_id = ?`
      )
      .get(groupId, ownerId)
  );

  return row ? toGroup(row) : null;
}

export function createAgentGroup(
  orgId: string,
  ownerId: string,
  name: string,
  memberIds: string[]
): AgentGroup {
  const group: AgentGroup = {
    avatarVersion: null,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    memberIds,
    name,
  };

  withGroupDb(orgId, (db) =>
    db
      .query(
        "INSERT INTO groups (id, owner_user_id, name, member_ids, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        group.id,
        ownerId,
        group.name,
        JSON.stringify(memberIds),
        group.createdAt
      )
  );

  return group;
}

/** Renames the group and replaces its members; false when it is not this owner's. */
export function updateAgentGroup(
  orgId: string,
  ownerId: string,
  groupId: string,
  name: string,
  memberIds: string[]
): boolean {
  return withGroupDb(
    orgId,
    (db) =>
      db
        .query(
          "UPDATE groups SET name = ?, member_ids = ? WHERE id = ? AND owner_user_id = ?"
        )
        .run(name, JSON.stringify(memberIds), groupId, ownerId).changes > 0
  );
}

export function deleteAgentGroup(
  orgId: string,
  ownerId: string,
  groupId: string
): boolean {
  return withGroupDb(orgId, (db) => {
    const removed =
      db
        .query("DELETE FROM groups WHERE id = ? AND owner_user_id = ?")
        .run(groupId, ownerId).changes > 0;

    if (removed) {
      db.query("DELETE FROM rail_pins WHERE item_id = ?").run(groupId);
    }

    return removed;
  });
}

/** Replaces the group's image; false when the group is not this owner's. */
export function setAgentGroupAvatar(
  orgId: string,
  ownerId: string,
  groupId: string,
  mediaType: string,
  bytes: Uint8Array
): boolean {
  return withGroupDb(
    orgId,
    (db) =>
      db
        .query(
          `INSERT INTO group_avatars (group_id, media_type, bytes, updated_at)
            SELECT id, ?, ?, ? FROM groups WHERE id = ? AND owner_user_id = ?
            ON CONFLICT (group_id) DO UPDATE SET media_type = excluded.media_type,
              bytes = excluded.bytes, updated_at = excluded.updated_at`
        )
        .run(mediaType, bytes, new Date().toISOString(), groupId, ownerId)
        .changes > 0
  );
}

export function getAgentGroupAvatar(
  orgId: string,
  ownerId: string,
  groupId: string
): { bytes: Uint8Array; mediaType: string } | null {
  const row = withGroupDb(orgId, (db) =>
    db
      .query<{ bytes: Uint8Array; media_type: string }, [string, string]>(
        `SELECT a.bytes, a.media_type FROM group_avatars a
          JOIN groups g ON g.id = a.group_id WHERE g.id = ? AND g.owner_user_id = ?`
      )
      .get(groupId, ownerId)
  );

  return row ? { bytes: row.bytes, mediaType: row.media_type } : null;
}

export function deleteAgentGroupAvatar(
  orgId: string,
  ownerId: string,
  groupId: string
): boolean {
  return withGroupDb(
    orgId,
    (db) =>
      db
        .query(
          `DELETE FROM group_avatars WHERE group_id IN
            (SELECT id FROM groups WHERE id = ? AND owner_user_id = ?)`
        )
        .run(groupId, ownerId).changes > 0
  );
}

export function listRailPins(orgId: string, userId: string): string[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<{ item_id: string }, [string]>(
        // A re-pin replaces the row, so the newest rowid is the latest pin.
        "SELECT item_id FROM rail_pins WHERE user_id = ? ORDER BY rowid DESC"
      )
      .all(userId)
      .map((row) => row.item_id)
  );
}

export function setRailPin(
  orgId: string,
  userId: string,
  itemId: string,
  pinned: boolean
): void {
  withGroupDb(orgId, (db) =>
    pinned
      ? db
          .query(
            "INSERT OR REPLACE INTO rail_pins (user_id, item_id) VALUES (?, ?)"
          )
          .run(userId, itemId)
      : db
          .query("DELETE FROM rail_pins WHERE user_id = ? AND item_id = ?")
          .run(userId, itemId)
  );
}

/** Latest activity first, like an agent's recent chats. */
export function listGroupSessions(
  orgId: string,
  ownerId: string,
  groupId: string
): StoredGroupSession[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<SessionRow, [string, string]>(
        // The newest message id orders by activity exactly; timestamps can tie.
        `SELECT ${SESSION_COLUMNS} WHERE s.group_id = ? AND g.owner_user_id = ?
          ORDER BY COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.session_id = s.id), 0) DESC,
            s.created_at DESC`
      )
      .all(groupId, ownerId)
      .map(toSession)
  );
}

export function getGroupSession(
  orgId: string,
  ownerId: string,
  groupId: string,
  sessionId: string
): StoredGroupSession | null {
  const row = withGroupDb(orgId, (db) =>
    db
      .query<SessionRow, [string, string, string]>(
        `SELECT ${SESSION_COLUMNS} WHERE s.id = ? AND s.group_id = ? AND g.owner_user_id = ?`
      )
      .get(sessionId, groupId, ownerId)
  );

  return row ? toSession(row) : null;
}

/** The group must already be checked as the owner's. */
export function createGroupSession(
  orgId: string,
  groupId: string,
  title: string
): StoredGroupSession {
  const now = new Date().toISOString();

  const session: StoredGroupSession = {
    createdAt: now,
    groupId,
    id: randomUUID(),
    pinned: false,
    title,
    updatedAt: now,
  };

  withGroupDb(orgId, (db) =>
    db
      .query(
        "INSERT INTO group_sessions (id, group_id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
      )
      .run(session.id, groupId, title, now, now)
  );

  return session;
}

export function updateGroupSession(
  orgId: string,
  ownerId: string,
  groupId: string,
  sessionId: string,
  changes: { pinned?: boolean; title?: string }
): boolean {
  const current = getGroupSession(orgId, ownerId, groupId, sessionId);

  if (!current) {
    return false;
  }

  withGroupDb(orgId, (db) =>
    db
      .query("UPDATE group_sessions SET title = ?, pinned = ? WHERE id = ?")
      .run(
        changes.title ?? current.title,
        (changes.pinned ?? current.pinned) ? 1 : 0,
        sessionId
      )
  );

  return true;
}

export function deleteGroupSession(
  orgId: string,
  ownerId: string,
  groupId: string,
  sessionId: string
): boolean {
  return withGroupDb(
    orgId,
    (db) =>
      db
        .query(
          `DELETE FROM group_sessions WHERE id = ? AND group_id IN
            (SELECT id FROM groups WHERE id = ? AND owner_user_id = ?)`
        )
        .run(sessionId, groupId, ownerId).changes > 0
  );
}

/** The newest `limit` messages of a session, oldest first. */
export function listAgentGroupMessages(
  orgId: string,
  sessionId: string,
  limit = 200
): AgentGroupMessage[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<MessageRow, [string, number]>(
        `SELECT * FROM (SELECT id, author_profile_id, content, created_at FROM messages
          WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id`
      )
      .all(sessionId, limit)
      .map(toMessage)
  );
}

/**
 * Appends to a session and marks it as the latest activity. Throws once the
 * session or group is gone, which ends a run on a deleted conversation.
 */
export function appendAgentGroupMessage(
  orgId: string,
  session: Pick<StoredGroupSession, "groupId" | "id">,
  authorProfileId: string | null,
  content: string
): AgentGroupMessage {
  const createdAt = new Date().toISOString();

  const { lastInsertRowid } = withGroupDb(orgId, (db) =>
    db.transaction(() => {
      const inserted = db
        .query(
          "INSERT INTO messages (group_id, session_id, author_profile_id, content, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(session.groupId, session.id, authorProfileId, content, createdAt);

      db.query("UPDATE group_sessions SET updated_at = ? WHERE id = ?").run(
        createdAt,
        session.id
      );

      return inserted;
    })()
  );

  return { authorProfileId, content, createdAt, id: Number(lastInsertRowid) };
}
