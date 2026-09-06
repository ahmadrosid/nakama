import { Database } from "bun:sqlite";

export async function run(_input, context) {
  const db = new Database(context.databasePath);
  try {
    return {
      notes: db
        .query(
          "SELECT id, title, body, created_at AS createdAt, pinned FROM notes ORDER BY created_at ASC"
        )
        .all(),
    };
  } finally {
    db.close();
  }
}
