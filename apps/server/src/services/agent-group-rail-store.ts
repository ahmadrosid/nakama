import { withGroupDb } from "./agent-group-store";

/** Chats of the user's own groups each agent replied in; unused agents are absent. */
export function listGroupAgentUsage(
  orgId: string,
  userId: string
): { chats: number; lastUsedAt: string; profileId: string }[] {
  return withGroupDb(orgId, (db) =>
    db
      .query<
        { chats: number; last_used_at: string; profile_id: string },
        [string]
      >(
        // Through group_sessions, so both joins use an index.
        `SELECT m.author_profile_id AS profile_id,
          COUNT(DISTINCT m.session_id) AS chats, MAX(m.created_at) AS last_used_at
          FROM groups g JOIN group_sessions s ON s.group_id = g.id
          JOIN messages m ON m.session_id = s.id
          WHERE g.owner_user_id = ? AND m.author_profile_id IS NOT NULL AND m.content <> ''
          GROUP BY m.author_profile_id`
      )
      .all(userId)
      .map((row) => ({
        chats: row.chats,
        lastUsedAt: row.last_used_at,
        profileId: row.profile_id,
      }))
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
