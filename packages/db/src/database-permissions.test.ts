import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openPrivateDatabase } from "./adapters/sqlite";

// Windows has no POSIX mode bits, so the assertions below cannot mean anything
// there. Everything else under ~/.nakama is 0600/0700; the database holds
// plaintext MCP credentials and every transcript, so it follows the same rule.
const posix = process.platform !== "win32";

function modeOf(path: string): number {
  // biome-ignore lint/suspicious/noBitwiseOperators: masking the permission bits out of st_mode is what the operator is for.
  return statSync(path).mode & 0o777;
}

describe("database permissions", () => {
  test("persistent connections keep durable settings and committed data after reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "nakama-db-durable-"));
    const databasePath = join(root, "nakama.sqlite");
    let db = openPrivateDatabase(databasePath);

    try {
      expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 3 });
      expect(db.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "delete",
      });
      db.exec("CREATE TABLE durable_marker (value TEXT NOT NULL)");
      db.transaction(() =>
        db.run("INSERT INTO durable_marker VALUES (?)", ["committed"])
      )();
      db.close();
      db = openPrivateDatabase(databasePath);
      expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 3 });
      expect(db.query("SELECT value FROM durable_marker").get()).toEqual({
        value: "committed",
      });
      expect(db.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      db.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  test.skipIf(!posix)("a fresh database is private", () => {
    const root = mkdtempSync(join(tmpdir(), "nakama-db-perms-"));
    const databasePath = join(root, "data", "sqlite", "nakama.sqlite");

    try {
      const db = openPrivateDatabase(databasePath);
      db.close();

      expect(modeOf(databasePath)).toBe(0o600);
      expect(modeOf(dirname(databasePath))).toBe(0o700);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test.skipIf(!posix)("startup tightens a world-readable database", () => {
    const root = mkdtempSync(join(tmpdir(), "nakama-db-perms-"));
    const databasePath = join(root, "data", "sqlite", "nakama.sqlite");

    try {
      mkdirSync(dirname(databasePath), { recursive: true });
      chmodSync(dirname(databasePath), 0o755);
      writeFileSync(databasePath, "");
      chmodSync(databasePath, 0o644);

      const db = openPrivateDatabase(databasePath);
      db.close();

      expect(modeOf(databasePath)).toBe(0o600);
      expect(modeOf(dirname(databasePath))).toBe(0o700);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
