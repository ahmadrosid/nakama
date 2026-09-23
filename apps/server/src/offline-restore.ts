import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getUserConfigDir } from "@nakama/core";
import {
  MAX_IMPORT_ARCHIVE_BYTES,
  restoreNakamaDataImport,
} from "./services/data-portability";
import { acquireDataRootLock } from "./services/data-root-lock";

async function main(): Promise<void> {
  if (process.argv.length !== 4 || process.argv[2] !== "--yes") {
    throw new Error("Usage: bun run restore:offline --yes <backup.zip>");
  }

  const rootDir = getUserConfigDir();
  const release = acquireDataRootLock(rootDir);
  try {
    const archivePath = await realpath(resolve(process.argv[3]));
    const rootPath = await realpath(rootDir);
    const insideRoot = relative(rootPath, archivePath);
    if (
      insideRoot !== ".." &&
      !insideRoot.startsWith(`..${sep}`) &&
      !isAbsolute(insideRoot)
    ) {
      throw new Error("Keep the backup ZIP outside the Nakama data directory.");
    }
    if ((await stat(archivePath)).size > MAX_IMPORT_ARCHIVE_BYTES) {
      throw new Error("Backup ZIP exceeds the import size limit.");
    }

    const result = await restoreNakamaDataImport(await readFile(archivePath), {
      confirm: true,
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
