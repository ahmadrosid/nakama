import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export async function run(input, context) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body : "";
  if (!title) {
    throw new Error("title is required");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const db = new Database(context.databasePath);
  try {
    db.run(
      "INSERT INTO notes (id, title, body, created_at) VALUES (?, ?, ?, ?)",
      [id, title, body, createdAt]
    );
    return { body, createdAt, id, title };
  } finally {
    db.close();
  }
}
