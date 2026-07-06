import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  getUserConfigDir,
  NAKAMA_API_VERSION,
  type DataExportManifest,
  type DataExportSkippedItem,
  type DataImportPreviewResponse,
  type RestoreDataImportResponse,
} from "@nakama/core";

export const NAKAMA_EXPORT_MANIFEST = "nakama-export.json";
export const NAKAMA_EXPORT_FORMAT_VERSION = 1;

export interface CreateDataExportOptions {
  rootDir?: string;
  now?: Date;
  databasePath?: string | null;
}

export interface CreateDataExportResult {
  filename: string;
  data: Buffer;
  manifest: DataExportManifest;
}

export interface PreviewDataImportOptions {
  rootDir?: string;
}

export interface RestoreDataImportOptions {
  rootDir?: string;
  confirm: boolean;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  uncompressedSize: number;
}

interface InventoryItem {
  relativePath: string;
  absolutePath: string;
  size: number;
}

const RESTORE_PREFIX = ".nakama-restore-";
const BACKUP_PREFIX = ".nakama-backup-";

export async function createNakamaDataExport(
  options: CreateDataExportOptions = {},
): Promise<CreateDataExportResult> {
  const rootDir = resolve(options.rootDir ?? getUserConfigDir());
  const createdAt = (options.now ?? new Date()).toISOString();
  const { files, skipped } = await inventoryConfigRoot(rootDir);
  const topLevelPaths = Array.from(
    new Set(files.map((file) => file.relativePath.split("/")[0]).filter(Boolean)),
  ).sort();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (options.databasePath) {
    const databasePath = resolve(options.databasePath);
    const relativeDatabasePath = relative(rootDir, databasePath);
    if (relativeDatabasePath.startsWith("..") || isAbsolute(relativeDatabasePath)) {
      skipped.push({ path: databasePath, reason: "Database path is outside the Nakama root." });
    }
  }

  const manifest: DataExportManifest = {
    kind: "nakama-export",
    version: NAKAMA_EXPORT_FORMAT_VERSION,
    apiVersion: NAKAMA_API_VERSION,
    createdAt,
    sourceRootName: basename(rootDir) || ".nakama",
    topLevelPaths,
    fileCount: files.length,
    totalBytes,
    skipped,
  };

  const entries: Record<string, Uint8Array> = {
    [NAKAMA_EXPORT_MANIFEST]: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
  };

  for (const file of files) {
    validateArchivePath(file.relativePath);
    entries[file.relativePath] = await readFile(file.absolutePath);
  }

  return {
    filename: `nakama-export-${createdAt.replace(/[:.]/g, "-")}.zip`,
    data: Buffer.from(zipSync(entries)),
    manifest,
  };
}

export async function previewNakamaDataImport(
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: PreviewDataImportOptions = {},
): Promise<DataImportPreviewResponse> {
  const rootDir = resolve(options.rootDir ?? getUserConfigDir());
  const entries = readZip(toBuffer(archive));
  const manifest = readManifest(entries);
  const restorableEntries = entries.filter((entry) => entry.name !== NAKAMA_EXPORT_MANIFEST);

  return {
    manifest,
    archiveFileCount: restorableEntries.length,
    archiveTotalBytes: restorableEntries.reduce((sum, entry) => sum + entry.uncompressedSize, 0),
    topLevelPaths: Array.from(
      new Set(restorableEntries.map((entry) => entry.name.split("/")[0]).filter(Boolean)),
    ).sort(),
    willReplaceRoot: await pathExists(rootDir),
  };
}

export async function restoreNakamaDataImport(
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: RestoreDataImportOptions,
): Promise<RestoreDataImportResponse> {
  if (!options.confirm) {
    throw new Error("Restore confirmation is required.");
  }

  const rootDir = resolve(options.rootDir ?? getUserConfigDir());
  const rootParent = dirname(rootDir);
  const entries = readZip(toBuffer(archive));
  const manifest = readManifest(entries);
  const stagingParent = await mkdtemp(join(rootParent, RESTORE_PREFIX));
  const stagedRoot = join(stagingParent, "root");
  const backupRoot = join(rootParent, `${BACKUP_PREFIX}${Date.now()}`);

  let movedCurrentToBackup = false;

  try {
    await mkdir(stagedRoot, { recursive: true, mode: 0o700 });
    let restoredFileCount = 0;

    for (const entry of entries) {
      if (entry.name === NAKAMA_EXPORT_MANIFEST) {
        continue;
      }

      await writeRestoredEntry(stagedRoot, entry);
      restoredFileCount += 1;
    }

    await mkdir(rootParent, { recursive: true, mode: 0o700 });
    if (await pathExists(rootDir)) {
      await rename(rootDir, backupRoot);
      movedCurrentToBackup = true;
    }

    await rename(stagedRoot, rootDir);

    if (movedCurrentToBackup) {
      await rm(backupRoot, { recursive: true, force: true });
    }

    return {
      manifest,
      restoredRoot: rootDir,
      restoredFileCount,
    };
  } catch (error) {
    if (movedCurrentToBackup && !(await pathExists(rootDir))) {
      await rename(backupRoot, rootDir);
    }

    throw error;
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
  }
}

async function inventoryConfigRoot(rootDir: string): Promise<{
  files: InventoryItem[];
  skipped: DataExportSkippedItem[];
}> {
  const files: InventoryItem[] = [];
  const skipped: DataExportSkippedItem[] = [];

  if (!(await pathExists(rootDir))) {
    return { files, skipped };
  }

  await walk(rootDir);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, skipped };

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = toZipPath(relative(rootDir, absolutePath));

      if (shouldSkipRelativePath(relativePath)) {
        skipped.push({ path: relativePath, reason: "Internal data-portability temporary path." });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push({ path: relativePath, reason: "Only regular files are exported." });
        continue;
      }

      const stat = await lstat(absolutePath);
      files.push({ relativePath, absolutePath, size: stat.size });
    }
  }
}

async function writeRestoredEntry(rootDir: string, entry: ZipEntry): Promise<void> {
  validateArchivePath(entry.name);
  const targetPath = resolve(rootDir, entry.name);
  const relativeTarget = relative(rootDir, targetPath);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new Error(`Archive entry escapes restore root: ${entry.name}`);
  }

  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  await writeFile(targetPath, entry.data, { mode: 0o600 });
}

function readZip(buffer: Buffer): ZipEntry[] {
  try {
    return Object.entries(unzipSync(buffer))
      .filter(([name]) => !name.endsWith("/"))
      .map(([name, data]) => {
        validateArchivePath(name);
        const entryData = Buffer.from(data);
        return {
          name,
          data: entryData,
          uncompressedSize: entryData.length,
        };
      });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "invalid zip data") {
        throw new Error("Invalid ZIP archive.");
      }
      throw new Error(`Invalid ZIP archive. ${error.message}`);
    }
    throw new Error("Invalid ZIP archive.");
  }
}

function readManifest(entries: ZipEntry[]): DataExportManifest {
  const manifestEntry = entries.find((entry) => entry.name === NAKAMA_EXPORT_MANIFEST);
  if (!manifestEntry) {
    throw new Error("Archive is missing Tinyclaw export manifest.");
  }

  let manifest: DataExportManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf8")) as DataExportManifest;
  } catch {
    throw new Error("Tinyclaw export manifest is not valid JSON.");
  }

  if (manifest.kind !== "nakama-export") {
    throw new Error("Archive is not a Tinyclaw export.");
  }

  if (manifest.version !== NAKAMA_EXPORT_FORMAT_VERSION) {
    throw new Error(`Unsupported Tinyclaw export version: ${manifest.version}`);
  }

  return manifest;
}

function validateArchivePath(path: string): void {
  if (!path || path.includes("\0")) {
    throw new Error("Archive entry path is empty or invalid.");
  }

  if (path !== toZipPath(path)) {
    throw new Error(`Archive entry must use POSIX separators: ${path}`);
  }

  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`Archive entry must be relative: ${path}`);
  }

  const normalized = normalize(path).split(sep).join("/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Archive entry escapes restore root: ${path}`);
  }
}

function toZipPath(path: string): string {
  return path.split(sep).join("/");
}

function shouldSkipRelativePath(path: string): boolean {
  const first = path.split("/")[0];
  return (
    first === NAKAMA_EXPORT_MANIFEST ||
    first.startsWith(RESTORE_PREFIX) ||
    first.startsWith(BACKUP_PREFIX)
  );
}

function toBuffer(value: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
