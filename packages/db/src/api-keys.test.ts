import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrateDatabase } from "./migrate";

test("removes retired backend credentials on every migration, including restored databases", () => {
  const db = new Database(":memory:");
  try {
    migrateDatabase(db);
    db.exec(
      "CREATE TABLE api_keys (id TEXT, secret_hash TEXT); INSERT INTO api_keys VALUES ('legacy', 'retired-secret')"
    );
    migrateDatabase(db);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name = 'api_keys'").all()
    ).toEqual([]);
    migrateDatabase(db);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name = 'api_keys'").all()
    ).toEqual([]);
  } finally {
    db.close();
  }
});
