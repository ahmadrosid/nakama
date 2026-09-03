import {
  cp,
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
import {
  type DataExportManifest,
  type DataExportSkippedItem,
  type DataImportPreviewResponse,
  getUserConfigDir,
  NAKAMA_API_VERSION,
  NakamaApiError,
  pathExists,
  type RestoreDataImportResponse,
} from "@nakama/core";
import { unzipSync, zipSync } from "fflate";

export const NAKAMA_EXPORT_MANIFEST = "nakama-export.json";
export const NAKAMA_EXPORT_FORMAT_VERSION = 1;

// Setup import is unauthenticated until the first admin exists, so an archive
// has to be capped on the way in rather than once it is already in memory.
export const MAX_IMPORT_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_ENTRY_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
/** Base64 carries 3 bytes per 4 characters. */
const MAX_IMPORT_ARCHIVE_BASE64_CHARS =
  Math.ceil(MAX_IMPORT_ARCHIVE_BYTES / 3) * 4;

export interface CreateDataExportOptions {
  databasePath?: string | null;
  now?: Date;
  rootDir?: string;
}

export interface CreateDataExportResult {
  data: Buffer;
  filename: string;
  manifest: DataExportManifest;
}

export interface PreviewDataImportOptions {
  rootDir?: string;
}

export interface RestoreDataImportOptions {
  confirm: boolean;
  rootDir?: string;
}

interface ZipEntry {
  data: Buffer;
  name: string;
  uncompressedSize: number;
}

interface InventoryItem {
  absolutePath: string;
  relativePath: string;
  size: number;
}

const RESTORE_PREFIX = ".nakama-restore-";
const BACKUP_PREFIX = ".nakama-backup-";

function resolveNakamaRootDir(rootDir?: string): string {
  const raw = rootDir ?? getUserConfigDir();
  if (!isAbsolute(raw)) {
    throw new Error(
      "rootDir must be an absolute path; relative paths resolve against process.cwd() and break config isolation."
    );
  }
  return resolve(raw);
}

export async function createNakamaDataExport(
  options: CreateDataExportOptions = {}
): Promise<CreateDataExportResult> {
  const rootDir = resolveNakamaRootDir(options.rootDir);
  const createdAt = (options.now ?? new Date()).toISOString();
  const { files, skipped } = await inventoryConfigRoot(rootDir);
  const topLevelPaths = Array.from(
    new Set(
      files.map((file) => file.relativePath.split("/")[0]).filter(Boolean)
    )
  ).sort();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (options.databasePath) {
    const databasePath = resolve(options.databasePath);
    const relativeDatabasePath = relative(rootDir, databasePath);
    if (
      relativeDatabasePath.startsWith("..") ||
      isAbsolute(relativeDatabasePath)
    ) {
      skipped.push({
        path: databasePath,
        reason: "Database path is outside the Nakama root.",
      });
    }
  }

  const manifest: DataExportManifest = {
    apiVersion: NAKAMA_API_VERSION,
    createdAt,
    fileCount: files.length,
    kind: "nakama-export",
    skipped,
    sourceRootName: basename(rootDir) || ".nakama",
    topLevelPaths,
    totalBytes,
    version: NAKAMA_EXPORT_FORMAT_VERSION,
  };

  const entries: Record<string, Uint8Array> = {
    [NAKAMA_EXPORT_MANIFEST]: Buffer.from(
      JSON.stringify(manifest, null, 2),
      "utf8"
    ),
  };

  for (const file of files) {
    validateArchivePath(file.relativePath);
    entries[file.relativePath] = await readFile(file.absolutePath);
  }

  return {
    data: Buffer.from(zipSync(entries)),
    filename: `nakama-export-${createdAt.replace(/[:.]/g, "-")}.zip`,
    manifest,
  };
}

export async function previewNakamaDataImport(
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: PreviewDataImportOptions = {}
): Promise<DataImportPreviewResponse> {
  const rootDir = resolveNakamaRootDir(options.rootDir);
  const entries = readZip(toBuffer(archive));
  const manifest = readManifest(entries);
  const restorableEntries = entries.filter(
    (entry) => entry.name !== NAKAMA_EXPORT_MANIFEST
  );

  return {
    archiveFileCount: restorableEntries.length,
    archiveTotalBytes: restorableEntries.reduce(
      (sum, entry) => sum + entry.uncompressedSize,
      0
    ),
    manifest,
    topLevelPaths: Array.from(
      new Set(
        restorableEntries
          .map((entry) => entry.name.split("/")[0])
          .filter(Boolean)
      )
    ).sort(),
    willReplaceRoot: await pathExists(rootDir),
  };
}

export function decodeArchiveRequestData(data: string): Buffer {
  // Checked before the trim, so an oversized payload is rejected without
  // being copied and then decoded.
  if (data.length > MAX_IMPORT_ARCHIVE_BASE64_CHARS) {
    throw new NakamaApiError(
      `Import archive must be at most ${megabytes(MAX_IMPORT_ARCHIVE_BYTES)}.`,
      413
    );
  }

  const trimmed = data.trim();
  if (!trimmed) {
    throw new NakamaApiError("Import archive data is required.", 400);
  }

  return Buffer.from(trimmed, "base64");
}

function megabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}

export async function restoreNakamaDataImport(
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: RestoreDataImportOptions
): Promise<RestoreDataImportResponse> {
  if (!options.confirm) {
    throw new NakamaApiError("Restore confirmation is required.", 400);
  }

  const rootDir = resolveNakamaRootDir(options.rootDir);
  const entries = readZip(toBuffer(archive));
  const manifest = readManifest(entries);

  // Stage and back up inside rootDir so Docker volume mounts (e.g. /nakama/data)
  // are never renamed — rename(2) on a mount point returns EBUSY.
  await mkdir(rootDir, { mode: 0o700, recursive: true });
  const stagingParent = await mkdtemp(join(rootDir, RESTORE_PREFIX));
  const stagedRoot = join(stagingParent, "root");
  const backupRoot = join(rootDir, `${BACKUP_PREFIX}${Date.now()}`);
  const backedUpEntries: string[] = [];
  let backupComplete = false;
  let restoreCommitted = false;

  try {
    await mkdir(stagedRoot, { mode: 0o700, recursive: true });
    let restoredFileCount = 0;

    for (const entry of entries) {
      if (entry.name === NAKAMA_EXPORT_MANIFEST) {
        continue;
      }

      await writeRestoredEntry(stagedRoot, entry);
      restoredFileCount += 1;
    }

    const existingEntries = await listMovableTopLevelEntries(rootDir);
    if (existingEntries.length > 0) {
      await mkdir(backupRoot, { mode: 0o700, recursive: true });
      for (const name of existingEntries) {
        await movePath(join(rootDir, name), join(backupRoot, name));
        backedUpEntries.push(name);
      }
      backupComplete = true;
    } else {
      backupComplete = true;
    }

    for (const name of await readdir(stagedRoot)) {
      await movePath(join(stagedRoot, name), join(rootDir, name));
    }
    restoreCommitted = true;

    if (backedUpEntries.length > 0) {
      try {
        await rm(backupRoot, { force: true, recursive: true });
      } catch {
        // Restore already committed — leave an orphan backup rather than rolling back.
      }
    }

    return {
      manifest,
      restoredFileCount,
      restoredRoot: rootDir,
    };
  } catch (error) {
    if (
      !restoreCommitted &&
      backedUpEntries.length > 0 &&
      (await pathExists(backupRoot))
    ) {
      try {
        if (backupComplete) {
          for (const name of await listMovableTopLevelEntries(rootDir)) {
            await rm(join(rootDir, name), { force: true, recursive: true });
          }
          for (const name of backedUpEntries) {
            const from = join(backupRoot, name);
            if (await pathExists(from)) {
              await movePath(from, join(rootDir, name));
            }
          }
        } else {
          // Partial backup: only put back what we moved; never delete unbacked siblings.
          for (const name of backedUpEntries) {
            const live = join(rootDir, name);
            if (await pathExists(live)) {
              await rm(live, { force: true, recursive: true });
            }
            const from = join(backupRoot, name);
            if (await pathExists(from)) {
              await movePath(from, live);
            }
          }
        }
        await rm(backupRoot, { force: true, recursive: true });
      } catch {
        // Keep backupRoot for manual recovery if rollback itself fails.
      }
    }

    throw error;
  } finally {
    await rm(stagingParent, { force: true, recursive: true });
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
        skipped.push({
          path: relativePath,
          reason: "Internal data-portability temporary path.",
        });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push({
          path: relativePath,
          reason: "Only regular files are exported.",
        });
        continue;
      }

      const stat = await lstat(absolutePath);
      files.push({ absolutePath, relativePath, size: stat.size });
    }
  }
}

async function writeRestoredEntry(
  rootDir: string,
  entry: ZipEntry
): Promise<void> {
  validateArchivePath(entry.name);
  const targetPath = resolve(rootDir, entry.name);
  const relativeTarget = relative(rootDir, targetPath);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new NakamaApiError(
      `Archive entry escapes restore root: ${entry.name}`,
      400
    );
  }

  await mkdir(dirname(targetPath), { mode: 0o700, recursive: true });
  await writeFile(targetPath, entry.data, { mode: 0o600 });
}

function readZip(buffer: Buffer): ZipEntry[] {
  let uncompressedTotal = 0;
  // fflate sizes each output buffer from the entry's declared uncompressed
  // size, so refusing here is what stops a bomb from being inflated at all.
  const admitEntry = (name: string, size: number): boolean => {
    if (size > MAX_IMPORT_ENTRY_BYTES) {
      throw new NakamaApiError(
        `Archive entry ${name} exceeds the ${megabytes(MAX_IMPORT_ENTRY_BYTES)} limit.`,
        400
      );
    }

    uncompressedTotal += size;
    if (uncompressedTotal > MAX_IMPORT_UNCOMPRESSED_BYTES) {
      throw new NakamaApiError(
        `Archive exceeds the ${megabytes(MAX_IMPORT_UNCOMPRESSED_BYTES)} uncompressed limit.`,
        400
      );
    }

    return true;
  };

  try {
    return Object.entries(
      unzipSync(buffer, {
        filter: (file) => admitEntry(file.name, file.originalSize),
      })
    )
      .filter(([name]) => !name.endsWith("/"))
      .map(([name, data]) => {
        validateArchivePath(name);
        const entryData = Buffer.from(data);
        return {
          data: entryData,
          name,
          uncompressedSize: entryData.length,
        };
      });
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw error;
    }
    throw new NakamaApiError("Invalid ZIP archive.", 400);
  }
}

function readManifest(entries: ZipEntry[]): DataExportManifest {
  const manifestEntry = entries.find(
    (entry) => entry.name === NAKAMA_EXPORT_MANIFEST
  );
  if (!manifestEntry) {
    throw new NakamaApiError("Archive is missing Nakama export manifest.", 400);
  }

  let manifest: DataExportManifest;
  try {
    manifest = JSON.parse(
      manifestEntry.data.toString("utf8")
    ) as DataExportManifest;
  } catch {
    throw new NakamaApiError("Nakama export manifest is not valid JSON.", 400);
  }

  if (manifest.kind !== "nakama-export") {
    throw new NakamaApiError("Archive is not a Nakama export.", 400);
  }

  if (manifest.version !== NAKAMA_EXPORT_FORMAT_VERSION) {
    throw new NakamaApiError(
      `Unsupported Nakama export version: ${manifest.version}`,
      400
    );
  }

  return manifest;
}

function validateArchivePath(path: string): void {
  if (!path || path.includes("\0")) {
    throw new NakamaApiError("Archive entry path is empty or invalid.", 400);
  }

  if (path !== toZipPath(path)) {
    throw new NakamaApiError(
      `Archive entry must use POSIX separators: ${path}`,
      400
    );
  }

  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) {
    throw new NakamaApiError(`Archive entry must be relative: ${path}`, 400);
  }

  const normalized = normalize(path).split(sep).join("/");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new NakamaApiError(
      `Archive entry escapes restore root: ${path}`,
      400
    );
  }

  const first = normalized.split("/")[0] ?? "";
  if (first.startsWith(RESTORE_PREFIX) || first.startsWith(BACKUP_PREFIX)) {
    throw new NakamaApiError(
      `Archive entry uses a reserved restore path: ${path}`,
      400
    );
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

async function listMovableTopLevelEntries(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir);
  return entries.filter(
    (name) =>
      !(name.startsWith(RESTORE_PREFIX) || name.startsWith(BACKUP_PREFIX))
  );
}

async function movePath(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (!isRetryableMoveError(error)) {
      throw error;
    }

    await cp(from, to, { force: true, recursive: true });
    await rm(from, { force: true, recursive: true });
  }
}

function isRetryableMoveError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "EBUSY" || code === "EXDEV" || code === "EPERM";
}
