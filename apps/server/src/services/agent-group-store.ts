import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getOrgConfigDir } from "@nakama/core";
import type {
  AgentGroup,
  AgentGroupMemoryChange,
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

// Latest main-chat message across the group's sessions, for the list preview.
const LAST_MESSAGE = (column: string) =>
  `(SELECT lm.${column} FROM messages lm WHERE lm.group_id = g.id AND lm.thread_root_id IS NULL
    AND (lm.author_profile_id IS NULL OR lm.content <> '') ORDER BY lm.id DESC LIMIT 1)`;

const GROUP_COLUMNS = `g.id, g.name, g.brief, g.member_ids, g.created_at, a.updated_at AS avatar_version,
  ${LAST_MESSAGE("content")} AS last_content,
  ${LAST_MESSAGE("author_profile_id")} AS last_author_profile_id,
  ${LAST_MESSAGE("created_at")} AS last_created_at
  FROM groups g LEFT JOIN group_avatars a ON a.group_id = g.id`;

// Joined to groups so every session read is scoped to the group's owner.
const SESSION_COLUMNS = `s.id, s.group_id, s.title, s.pinned, s.created_at, s.updated_at
  FROM group_sessions s JOIN groups g ON g.id = s.group_id`;

interface GroupRow {
  avatar_version: string | null;
  brief: string;
  created_at: string;
  id: string;
  last_author_profile_id: string | null;
  last_content: string | null;
  last_created_at: string | null;
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

/** A document the user attached, as the text the agents read. */
export interface GroupDocument {
  filename: string;
  /** An image's place in the group's shared folder, like uploads/ab12cd34.png. */
  path?: string;
  text: string;
}

interface MessageRow {
  author_profile_id: string | null;
  content: string;
  created_at: string;
  file_names: string;
  id: number;
  image_paths: string;
  memory_changes: string | null;
  thread_replies: number;
}

// Main messages carry their thread's reply count; thread messages carry none.
const MESSAGE_COLUMNS = `m.id, m.author_profile_id, m.content, m.created_at, m.memory_changes,
  (SELECT json_group_array(json_extract(d.value, '$.filename')) FROM json_each(m.documents) d
    WHERE json_extract(d.value, '$.path') IS NULL) AS file_names,
  (SELECT json_group_array(json_extract(d.value, '$.path')) FROM json_each(m.documents) d
    WHERE json_extract(d.value, '$.path') IS NOT NULL) AS image_paths,
  (SELECT COUNT(*) FROM messages t WHERE t.thread_root_id = m.id) AS thread_replies
  FROM messages m`;

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
      addThreadColumn(db);
      addBriefColumn(db);
      addDocumentsColumn(db);
      addMemoryChangesColumn(db);
    } catch (error) {
      db.close();
      throw error;
    }

    databases.set(path, db);
  }

  return run(db);
}

/** Threads came after the first release, so older files lack the column. */
function addThreadColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(messages)")
    .all();

  if (!columns.some((column) => column.name === "thread_root_id")) {
    db.exec(
      `ALTER TABLE messages ADD COLUMN thread_root_id INTEGER;
        CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_root_id, id);`
    );
  }
}

/** Briefs came after the first release, so older files lack the column. */
function addBriefColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(groups)")
    .all();

  if (!columns.some((column) => column.name === "brief")) {
    db.exec("ALTER TABLE groups ADD COLUMN brief TEXT NOT NULL DEFAULT ''");
  }
}

/** Attachments came after the first release, so older files lack the column. */
function addDocumentsColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(messages)")
    .all();

  if (!columns.some((column) => column.name === "documents")) {
    db.exec("ALTER TABLE messages ADD COLUMN documents TEXT");
  }
}

/** Older messages have no recorded memory changes. */
function addMemoryChangesColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(messages)")
    .all();

  if (!columns.some((column) => column.name === "memory_changes")) {
    db.exec("ALTER TABLE messages ADD COLUMN memory_changes TEXT");
  }
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
    brief: row.brief,
    createdAt: row.created_at,
    id: row.id,
    lastMessage:
      row.last_content === null || row.last_created_at === null
        ? null
        : {
            authorProfileId: row.last_author_profile_id,
            content: row.last_content,
            createdAt: row.last_created_at,
          },
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
  // SAFETY: file_names is built by json_group_array over filename strings.
  const files = JSON.parse(row.file_names) as string[];
  // SAFETY: image_paths is built by json_group_array over path strings.
  const images = JSON.parse(row.image_paths) as string[];

  // SAFETY: only this store writes memory_changes, from completed tool writes.
  const memoryChanges = JSON.parse(
    row.memory_changes ?? "[]"
  ) as AgentGroupMemoryChange[];

  return {
    authorProfileId: row.author_profile_id,
    content: row.content,
    createdAt: row.created_at,
    ...(files.length > 0 && { files }),
    id: row.id,
    ...(images.length > 0 && { images }),
    ...(memoryChanges.length > 0 && { memoryChanges }),
    threadReplies: row.thread_replies,
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
  memberIds: string[],
  brief = ""
): AgentGroup {
  const group: AgentGroup = {
    avatarVersion: null,
    brief,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    lastMessage: null,
    memberIds,
    name,
  };

  withGroupDb(orgId, (db) =>
    db
      .query(
        "INSERT INTO groups (id, owner_user_id, name, brief, member_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        group.id,
        ownerId,
        group.name,
        brief,
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
  memberIds: string[],
  brief = ""
): boolean {
  return withGroupDb(
    orgId,
    (db) =>
      db
        .query(
          "UPDATE groups SET name = ?, brief = ?, member_ids = ? WHERE id = ? AND owner_user_id = ?"
        )
        .run(name, brief, JSON.stringify(memberIds), groupId, ownerId).changes >
      0
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

/** The newest `limit` main-chat messages, oldest first; context reads omit notices before limiting. */
export function listAgentGroupMessages(
  orgId: string,
  sessionId: string,
  limit = 200,
  includeNotices = true
): AgentGroupMessage[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<MessageRow, [string, number]>(
        `SELECT * FROM (SELECT ${MESSAGE_COLUMNS}
          WHERE m.session_id = ? AND m.thread_root_id IS NULL
          ${includeNotices ? "" : "AND (m.author_profile_id IS NULL OR m.content <> '')"}
          ORDER BY m.id DESC LIMIT ?) ORDER BY id`
      )
      .all(sessionId, limit)
      .map(toMessage)
  );
}

/** One main-chat message, or null when it is gone or sits inside a thread. */
export function getAgentGroupMessage(
  orgId: string,
  sessionId: string,
  messageId: number
): AgentGroupMessage | null {
  const row = withGroupDb(orgId, (db) =>
    db
      .query<MessageRow, [string, number]>(
        `SELECT ${MESSAGE_COLUMNS}
          WHERE m.session_id = ? AND m.id = ? AND m.thread_root_id IS NULL`
      )
      .get(sessionId, messageId)
  );

  return row ? toMessage(row) : null;
}

/** The replies in one thread, oldest first. */
export function listAgentGroupThreadMessages(
  orgId: string,
  sessionId: string,
  rootId: number
): AgentGroupMessage[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<MessageRow, [string, number]>(
        `SELECT ${MESSAGE_COLUMNS}
          WHERE m.session_id = ? AND m.thread_root_id = ? ORDER BY m.id`
      )
      .all(sessionId, rootId)
      .map(toMessage)
  );
}

/** The text of the documents attached to these messages, by message id. */
export function listGroupMessageDocuments(
  orgId: string,
  messageIds: number[]
): Map<number, GroupDocument[]> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const rows = withGroupDb(orgId, (db) =>
    db
      .query<{ documents: string; id: number }, number[]>(
        `SELECT id, documents FROM messages
          WHERE documents IS NOT NULL AND id IN (${messageIds.map(() => "?").join(",")})`
      )
      .all(...messageIds)
  );

  // SAFETY: documents is only ever written by this store as a GroupDocument array.
  return new Map(
    rows.map((row) => [row.id, JSON.parse(row.documents) as GroupDocument[]])
  );
}

/**
 * Appends to a session and marks it as the latest activity. With `threadRootId`
 * the message joins that message's thread instead of the main chat. Throws once
 * the session or group is gone, which ends a run on a deleted conversation.
 */
export function appendAgentGroupMessage(
  orgId: string,
  session: Pick<StoredGroupSession, "groupId" | "id">,
  authorProfileId: string | null,
  content: string,
  threadRootId?: number,
  documents: GroupDocument[] = [],
  memoryChanges: AgentGroupMemoryChange[] = []
): AgentGroupMessage {
  const createdAt = new Date().toISOString();
  const files = documents.flatMap((d) => (d.path ? [] : [d.filename]));
  const images = documents.flatMap((d) => (d.path ? [d.path] : []));

  const { lastInsertRowid } = withGroupDb(orgId, (db) =>
    db.transaction(() => {
      const inserted = db
        .query(
          "INSERT INTO messages (group_id, session_id, author_profile_id, content, created_at, thread_root_id, documents, memory_changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          session.groupId,
          session.id,
          authorProfileId,
          content,
          createdAt,
          threadRootId ?? null,
          documents.length > 0 ? JSON.stringify(documents) : null,
          memoryChanges.length > 0 ? JSON.stringify(memoryChanges) : null
        );

      db.query("UPDATE group_sessions SET updated_at = ? WHERE id = ?").run(
        createdAt,
        session.id
      );

      return inserted;
    })()
  );

  return {
    authorProfileId,
    content,
    createdAt,
    ...(files.length > 0 && { files }),
    id: Number(lastInsertRowid),
    ...(images.length > 0 && { images }),
    ...(memoryChanges.length > 0 && { memoryChanges }),
    threadReplies: 0,
  };
}
