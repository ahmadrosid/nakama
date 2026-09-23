import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getUserConfigDir, loadConfig } from "@nakama/core";
import { resolveDatabasePath } from "@nakama/db";
import {
  MAX_IMPORT_ARCHIVE_BYTES,
  restoreNakamaDataImport,
} from "./services/data-portability";
import { acquireDataRootLock } from "./services/data-root-lock";

function isInsideRoot(path: string): boolean {
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function main(): Promise<void> {
  if (process.argv.length !== 4 || process.argv[2] !== "--yes") {
    throw new Error("Usage: bun run restore:offline --yes <backup.zip>");
  }

  const rootDir = getUserConfigDir();
  const release = acquireDataRootLock(rootDir);
  try {
    const archivePath = await realpath(resolve(process.argv[3]));
    const rootPath = await realpath(rootDir);
    if (isInsideRoot(relative(rootPath, archivePath))) {
      throw new Error("Keep the backup ZIP outside the Nakama data directory.");
    }
    if ((await stat(archivePath)).size > MAX_IMPORT_ARCHIVE_BYTES) {
      throw new Error("Backup ZIP exceeds the import size limit.");
    }

    const configuredDatabasePath = resolveDatabasePath(
      loadConfig().databaseUrl,
      {
        baseDir: rootDir,
      }
    );
    let databasePath: string | null = null;
    if (configuredDatabasePath !== ":memory:") {
      const logicalPath = relative(rootDir, configuredDatabasePath);
      const relativePath = isInsideRoot(logicalPath)
        ? logicalPath
        : relative(rootPath, configuredDatabasePath);
      const candidate = resolve(rootPath, relativePath);
      databasePath = await realpath(candidate).catch(() => candidate);
      if (!isInsideRoot(relative(rootPath, databasePath))) {
        throw new Error(
          "The configured database is outside the Nakama data directory; it is not part of this backup."
        );
      }
    }

    const result = await restoreNakamaDataImport(await readFile(archivePath), {
      confirm: true,
      databasePath,
      rootDir,
    });
    console.log(
      `Restored ${result.restoredFileCount} files. Start Nakama to use the restored data.`
    );
  } finally {
    release();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
