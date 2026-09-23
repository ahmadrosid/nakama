import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getUserConfigDir } from "@nakama/core";

// Keep the lock inside the shared data volume. The restore service excludes
// .nakama-restore-* paths from exports and from directory replacement.
export function acquireDataRootLock(rootDir = getUserConfigDir()): () => void {
  mkdirSync(rootDir, { mode: 0o700, recursive: true });
  const lock = new Database(join(rootDir, ".nakama-restore-lock.sqlite"), {
    create: true,
  });
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lock.close();
    if (
      error instanceof Error &&
      error.message.includes("database is locked")
    ) {
      throw new Error(
        "Nakama is using this data directory. Stop the server before restoring."
      );
    }
    throw error;
  }
  return () => {
    try {
      lock.exec("ROLLBACK");
    } finally {
      lock.close(true);
    }
  };
}
