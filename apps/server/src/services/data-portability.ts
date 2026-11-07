import { Database } from "bun:sqlite";
import { once } from "node:events";
import { constants, createWriteStream, type Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  access,
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import {
  assertConfigPathSegment,
  type DataExportManifest,
  type DataExportSkippedItem,
  type DataImportPreviewResponse,
  getAttachmentFilePath,
  getKnowledgeBaseDir,
  getOrgKnowledgeBaseDir,
  getProfileSoulDir,
  getUserConfigDir,
  listArtifacts,
  loadConfig,
  NAKAMA_API_VERSION,
  NakamaApiError,
  pathExists,
  type RestoreDataImportResponse,
  readAttachmentBytes,
} from "@nakama/core";
import {
  createSqliteDatabase,
  type DatabaseAdapter,
  resolveDatabasePath,
} from "@nakama/db";
import { Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import * as yauzl from "yauzl";
import { decodeSecretsKey, ManagedSecrets } from "./managed-secrets";
import {
  PluginExportBarrierError,
  quarantineInvalidPluginReleases,
  runWithPluginExportBarrier,
  vacuumPluginDatabaseInto,
} from "./plugin-service";
import {
  decryptBackup,
  decryptBackupFile,
  isEncryptedBackup,
} from "./scheduled-backup";

export const NAKAMA_EXPORT_MANIFEST = "nakama-export.json";

export const NAKAMA_EXPORT_FORMAT_VERSION = 1;

export const NAKAMA_USER_EXPORT_MANIFEST = "nakama-user-export.json";

export const NAKAMA_USER_EXPORT_FORMAT_VERSION = 1;

export const NAKAMA_ORG_EXPORT_MANIFEST = "nakama-org-export.json";

export const NAKAMA_ORG_EXPORT_FORMAT_VERSION = 1;

// Setup import is unauthenticated until the first admin exists, so an archive
// has to be capped on the way in rather than once it is already in memory.
export const MAX_IMPORT_ARCHIVE_BYTES = 100 * 1024 * 1024;

export const MAX_IMPORT_ENTRIES = 10_000;

export const MAX_IMPORT_ENTRY_BYTES = 100 * 1024 * 1024;

export const MAX_IMPORT_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

export interface ImportLimits {
  archiveBytes: number;
  entries: number;
  entryBytes: number;
  uncompressedBytes: number;
}

/**
 * Authenticated admin routes may carry a full install backup. The writer is
 * ZIP32, so the archive must stay under 4 GiB.
 */
export const DATA_IMPORT_LIMITS: ImportLimits = {
  archiveBytes: 2 * 1024 * 1024 * 1024,
  entries: MAX_IMPORT_ENTRIES,
  entryBytes: 1024 * 1024 * 1024,
  uncompressedBytes: 3 * 1024 * 1024 * 1024,
};

/** The unauthenticated first-run import keeps the small, pre-admin budget. */
export const SETUP_IMPORT_LIMITS: ImportLimits = {
  archiveBytes: MAX_IMPORT_ARCHIVE_BYTES,
  entries: MAX_IMPORT_ENTRIES,
  entryBytes: MAX_IMPORT_ENTRY_BYTES,
  uncompressedBytes: MAX_IMPORT_UNCOMPRESSED_BYTES,
};

const MAX_DATA_IMPORT_ARCHIVE_BYTES = 3.5 * 1024 * 1024 * 1024;

const MAX_DATA_IMPORT_ENTRY_BYTES = 3.5 * 1024 * 1024 * 1024;

const MAX_DATA_IMPORT_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

function envLimit(name: string, fallback: number, ceiling: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!(Number.isFinite(value) && value > 0)) {
    return fallback;
  }

  return Math.min(Math.floor(value), ceiling);
}

/** Reads the admin caps at call time so deployments and tests can tune them. */
export function getDataImportLimits(): ImportLimits {
  return {
    archiveBytes: envLimit(
      "NAKAMA_DATA_IMPORT_MAX_ARCHIVE_BYTES",
      DATA_IMPORT_LIMITS.archiveBytes,
      MAX_DATA_IMPORT_ARCHIVE_BYTES
    ),
    entries: MAX_IMPORT_ENTRIES,
    entryBytes: envLimit(
      "NAKAMA_DATA_IMPORT_MAX_ENTRY_BYTES",
      DATA_IMPORT_LIMITS.entryBytes,
      MAX_DATA_IMPORT_ENTRY_BYTES
    ),
    uncompressedBytes: envLimit(
      "NAKAMA_DATA_IMPORT_MAX_UNCOMPRESSED_BYTES",
      DATA_IMPORT_LIMITS.uncompressedBytes,
      MAX_DATA_IMPORT_UNCOMPRESSED_BYTES
    ),
  };
}

/** Base64 carries 3 bytes per 4 characters. */
const MAX_IMPORT_ARCHIVE_BASE64_CHARS =
  Math.ceil(MAX_IMPORT_ARCHIVE_BYTES / 3) * 4;

export interface CreateDataExportOptions {
  databasePath?: string | null;
  drainTimeoutMs?: number;
  limits?: ImportLimits;
  now?: Date;
  rootDir?: string;
}

export interface CreateDataExportResult {
  data: Buffer;
  filename: string;
  manifest: DataExportManifest;
}

export interface CreateDataExportFileResult {
  cleanup: () => Promise<void>;
  filename: string;
  manifest: DataExportManifest;
  path: string;
}

export interface CreateUserDataExportResult {
  data: Buffer;
  filename: string;
}

export interface PreviewDataImportOptions {
  limits?: ImportLimits;
  rootDir?: string;
}

export interface RestoreDataImportOptions {
  /** Runs when a restore fails after `beforeReplace`, so the caller can reopen what is on disk. */
  afterFailedReplace?: () => Promise<void> | void;
  /**
   * Runs once the archive is staged, before any live entry moves. Windows cannot
   * rename or delete an open SQLite file, so the caller releases its handle here.
   */
  beforeReplace?: () => Promise<void> | void;
  confirm: boolean;
  databasePath?: string | null;
  limits?: ImportLimits;
  /** Defaults to `PM2_HOME` in the desktop app. A live pm2 home that is a top-level entry stays in place. */
  pm2Home?: string | null;
  rootDir?: string;
  /** Defaults to `NAKAMA_SERVER_LOG` in the desktop app, its log for this process. */
  serverLog?: string | null;
}

interface InventoryItem {
  absolutePath: string;
  relativePath: string;
}

const RESTORE_PREFIX = ".nakama-restore-";

const BACKUP_PREFIX = ".nakama-backup-";

const EXPORT_PREFIX = ".nakama-export-";

const UPLOAD_PREFIX = ".nakama-upload-";

const PLUGIN_SNAPSHOT_PREFIX = ".nakama-plugin-snapshot-";

const DELETED_DURING_EXPORT = "Deleted while the export ran.";

const CONFIG_FILES = new Set(["config.ini", "composio/config.ini"]);

const LITESTREAM_SUFFIX = "-litestream";

const ORG_PLUGIN_SQLITE = /^orgs\/[^/]+\/plugins\/[^/]+\/db\/[^/]+\.sqlite$/;

/**
 * Where the main database sits inside a data root: the server default
 * (`packages/core/src/config.ts`) and the desktop app (`apps/desktop/main.mjs`).
 * An archive from one layout must land where the restoring install reads it.
 */
const MAIN_DATABASE_LAYOUTS: readonly string[] = [
  "data/sqlite/nakama.sqlite",
  "sqlite/nakama.sqlite",
];

function resolveNakamaRootDir(rootDir?: string): string {
  const raw = rootDir ?? getUserConfigDir();

  if (!isAbsolute(raw)) {
    throw new Error(
      "rootDir must be an absolute path; relative paths resolve against process.cwd() and break config isolation."
    );
  }

  return resolve(raw);
}

function resolveConfiguredDatabasePath(
  rootDir: string,
  databasePath: string | null | undefined
): string | null {
  return databasePath === undefined
    ? resolveDatabasePath(loadConfig().databaseUrl, { baseDir: rootDir })
    : databasePath;
}

/** Keep retired data in full backups, outside every active profile workspace. */
export async function retireAppUserData(
  rootDir: string,
  databasePath: string | null
): Promise<void> {
  const root = await realpath(resolveNakamaRootDir(rootDir));
  const retired = join(root, "retired-app-users");

  const sessions: Array<{ id: string; org_id: string; profile_id: string }> =
    [];

  const attachments: Array<{ id: string; org_id: string; profile_id: string }> =
    [];

  if (
    databasePath &&
    databasePath !== ":memory:" &&
    (await pathExists(databasePath))
  ) {
    // Staged restores may predate these columns. Upgrade before inventorying.
    const migrated = await createSqliteDatabase(`file:${databasePath}`);

    // At startup the main connection already holds this file and its schema is
    // current, so the migration above commits nothing. Closing this second
    // connection can still raise "database is locked" (bun on macOS) while the
    // main connection is busy — that must not kill boot. In the restore flow
    // the live database is already released, so the close there keeps working.
    try {
      migrated.release();
    } catch {
      // Best effort: the handle is dropped when the adapter is collected.
    }

    const db = new Database(databasePath, { readonly: true });

    try {
      sessions.push(
        // SAFETY: The SELECT names the three columns in the sessions row contract.
        ...(db
          .query(`SELECT s.id, p.org_id, s.profile_id
        FROM sessions s JOIN profiles p ON p.id = s.profile_id
        WHERE s.app_user_id IS NOT NULL`)
          .all() as typeof sessions)
      );
      attachments.push(
        // SAFETY: The SELECT names the three columns in the attachments row contract.
        ...(db
          .query(`SELECT a.id, a.org_id, a.profile_id
        FROM attachments a JOIN sessions s ON s.id = a.session_id
        WHERE s.app_user_id IS NOT NULL`)
          .all() as typeof attachments)
      );
    } finally {
      db.close(true);
    }
  }

  async function checkedStat(target: string) {
    const rel = relative(root, target);

    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Retired data path escapes the config root.");
    }

    let current = root;
    let result;

    for (const segment of rel.split(sep).filter(Boolean)) {
      current = join(current, segment);

      try {
        // NTFS file ids pass 2^53; as numbers two files can share an ino.
        result = await lstat(current, { bigint: true });
      } catch (error) {
        const code = getNodeErrorCode(error);

        // ENOTDIR: a regular file occupies a directory segment's place
        // (e.g. a stray .DS_Store) — treat the target as absent.
        if (code === "ENOENT" || code === "ENOTDIR") {
          return null;
        }

        throw error;
      }

      if (result.isSymbolicLink()) {
        throw new Error("Retired data paths must not contain symlinks.");
      }
    }

    return result ?? (await lstat(root, { bigint: true }));
  }

  async function moveRetiredPath(
    source: string,
    target: string
  ): Promise<void> {
    const sourceStat = await checkedStat(source);

    if (!sourceStat) {
      return;
    }

    if (sourceStat.isDirectory()) {
      const targetStat = await checkedStat(target);

      if (targetStat && !targetStat.isDirectory()) {
        throw new Error("Retired data destination conflict.");
      }

      await mkdir(target, { mode: 0o700, recursive: true });
      await chmod(target, 0o700);

      for (const entry of await readdir(source)) {
        await moveRetiredPath(join(source, entry), join(target, entry));
      }

      await rmdir(source);

      return;
    }

    const targetStat = await checkedStat(target);

    if (
      targetStat &&
      sourceStat.ino === targetStat.ino &&
      sourceStat.dev === targetStat.dev
    ) {
      // A crash after link() left both names for the same file; finish the move.
      await chmod(target, 0o600);
      await unlink(source);

      return;
    }

    if (!sourceStat.isFile() || targetStat) {
      throw new Error("Retired data destination conflict or unsupported file.");
    }

    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    await checkedStat(target);
    // link() refuses an existing destination instead of overwriting it.
    await link(source, target);
    await chmod(target, 0o600);
    await unlink(source);
  }

  const orgsDir = join(root, "orgs");

  if (await checkedStat(orgsDir)) {
    for (const entry of await readdir(orgsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const profilesDir = join(orgsDir, entry.name, "profiles");

      if (!(await checkedStat(profilesDir))) {
        continue;
      }

      for (const profileId of await readdir(profilesDir)) {
        await moveRetiredPath(
          join(profilesDir, profileId, "users"),
          join(retired, entry.name, profileId, "users")
        );
      }
    }
  }

  for (const record of attachments) {
    const orgId = assertConfigPathSegment(record.org_id, "orgId");
    const profileId = assertConfigPathSegment(record.profile_id, "profileId");
    const id = assertConfigPathSegment(record.id, "attachmentId");
    await moveRetiredPath(
      join(root, "orgs", orgId, "profiles", profileId, "attachments", id),
      join(retired, orgId, profileId, "attachments", id)
    );
  }

  for (const record of sessions) {
    const orgId = assertConfigPathSegment(record.org_id, "orgId");
    const profileId = assertConfigPathSegment(record.profile_id, "profileId");
    const filename = `${encodeURIComponent(record.id)}.jsonl`;
    await moveRetiredPath(
      join(root, "orgs", orgId, "session-history", filename),
      join(retired, orgId, profileId, "session-history", filename)
    );
  }
}

export async function createNakamaDataExportFile(
  options: CreateDataExportOptions = {}
): Promise<CreateDataExportFileResult> {
  const rootDir = resolveNakamaRootDir(options.rootDir);
  const createdAt = (options.now ?? new Date()).toISOString();
  const limits = options.limits ?? getDataImportLimits();

  const configuredDatabasePath = resolveConfiguredDatabasePath(
    rootDir,
    options.databasePath
  );

  try {
    return await runWithPluginExportBarrier(
      async () => {
        await mkdir(rootDir, { mode: 0o700, recursive: true });
        const exportParent = await mkdtemp(join(rootDir, EXPORT_PREFIX));
        const archivePath = join(exportParent, "export.zip");

        try {
          const snapshotParent = await mkdtemp(
            join(exportParent, PLUGIN_SNAPSHOT_PREFIX)
          );

          const snapshots = await snapshotOrgPluginDatabases(
            rootDir,
            snapshotParent
          );

          const outsideDatabases: DataExportSkippedItem[] = [];

          if (configuredDatabasePath && configuredDatabasePath !== ":memory:") {
            const databasePath = resolve(configuredDatabasePath);
            const relativeDatabasePath = relative(rootDir, databasePath);

            if (
              relativeDatabasePath.startsWith("..") ||
              isAbsolute(relativeDatabasePath)
            ) {
              outsideDatabases.push({
                path: databasePath,
                reason: "Database path is outside the Nakama root.",
              });
            } else if (await pathExists(databasePath)) {
              const target = join(snapshotParent, relativeDatabasePath);
              await snapshotDatabaseInto(rootDir, databasePath, target);
              snapshots.set(toZipPath(relativeDatabasePath), target);
            }
          }

          const { files, skipped } = await inventoryConfigRoot(
            rootDir,
            snapshots
          );

          skipped.push(...outsideDatabases);

          const manifest = await writeExportArchive({
            archivePath,
            createdAt,
            files,
            limits,
            rootDir,
            skipped,
            snapshots,
          });

          let cleaned = false;

          const cleanup = async () => {
            if (cleaned) {
              return;
            }

            cleaned = true;
            await rm(exportParent, { force: true, recursive: true });
          };

          return {
            cleanup,
            filename: `nakama-export-${createdAt.replace(/[:.]/g, "-")}.zip`,
            manifest,
            path: archivePath,
          };
        } catch (error) {
          await rm(exportParent, { force: true, recursive: true });
          throw error;
        }
      },
      { drainTimeoutMs: options.drainTimeoutMs }
    );
  } catch (error) {
    if (error instanceof PluginExportBarrierError) {
      throw new NakamaApiError(error.message, 503);
    }

    throw error;
  }
}

/**
 * In-memory form, for tests and small callers. Routes and scheduled backups
 * must use `createNakamaDataExportFile` so a large install never sits in RAM.
 */
export async function createNakamaDataExport(
  options: CreateDataExportOptions = {}
): Promise<CreateDataExportResult> {
  const file = await createNakamaDataExportFile(options);

  try {
    return {
      data: await readFile(file.path),
      filename: file.filename,
      manifest: file.manifest,
    };
  } finally {
    await file.cleanup();
  }
}

async function writeExportArchive(options: {
  archivePath: string;
  createdAt: string;
  files: InventoryItem[];
  limits: ImportLimits;
  rootDir: string;
  skipped: DataExportSkippedItem[];
  snapshots: ReadonlyMap<string, string>;
}): Promise<DataExportManifest> {
  let entryCount = 0;
  let uncompressedTotal = 0;
  let archiveBytes = 0;
  let zipError: Error | null = null;
  const writtenPaths: string[] = [];

  const out = createWriteStream(options.archivePath, {
    highWaterMark: 1024 * 1024,
  });

  // A cap error destroys the stream; later fflate chunks must become no-ops.
  out.on("error", (error) => {
    zipError = zipError ?? error;
  });

  const zip = new Zip((error, chunk) => {
    if (error) {
      zipError = new Error(error.message);

      return;
    }

    if (
      !chunk ||
      chunk.byteLength === 0 ||
      zipError ||
      out.destroyed ||
      out.writableEnded
    ) {
      return;
    }

    archiveBytes += chunk.byteLength;

    if (archiveBytes > options.limits.archiveBytes) {
      zipError = new NakamaApiError(
        `Cannot export a restorable backup: ZIP exceeds the ${megabytes(options.limits.archiveBytes)} import limit. Use a filesystem or volume backup instead.`,
        413
      );

      return;
    }

    out.write(chunk);
  });

  const addEntry = async (
    name: string,
    write: (entry: ZipDeflate | ZipPassThrough) => Promise<void>,
    compress: boolean
  ): Promise<void> => {
    validateArchivePath(name);
    entryCount += 1;

    if (entryCount > options.limits.entries) {
      throw new NakamaApiError(
        `Cannot export a restorable backup: Archive exceeds the ${options.limits.entries} entry limit. Use a filesystem or volume backup instead.`,
        413
      );
    }

    const entry = compress
      ? new ZipDeflate(name, { level: 6 })
      : new ZipPassThrough(name);

    zip.add(entry);

    try {
      await write(entry);
    } catch (error) {
      zipError =
        zipError ?? (error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    if (zipError) {
      throw zipError;
    }

    if (out.writableNeedDrain) {
      await once(out, "drain");
    }

    writtenPaths.push(name);
  };

  const addBufferEntry = async (
    name: string,
    data: Uint8Array,
    compress: boolean
  ): Promise<void> => {
    if (data.byteLength > options.limits.entryBytes) {
      throw new NakamaApiError(
        `Cannot export a restorable backup: Archive entry ${name} exceeds the ${megabytes(options.limits.entryBytes)} limit. Use a filesystem or volume backup instead.`,
        413
      );
    }

    if (
      uncompressedTotal + data.byteLength >
      options.limits.uncompressedBytes
    ) {
      throw new NakamaApiError(
        `Cannot export a restorable backup: Archive exceeds the ${megabytes(options.limits.uncompressedBytes)} uncompressed limit. Use a filesystem or volume backup instead.`,
        413
      );
    }

    await addEntry(
      name,
      async (entry) => {
        entry.push(data, false);
        entry.push(new Uint8Array(0), true);
      },
      compress
    );

    uncompressedTotal += data.byteLength;
  };

  const addFileEntry = async (
    name: string,
    absolutePath: string,
    compress: boolean
  ): Promise<void> => {
    let handle: FileHandle;

    try {
      handle = await open(absolutePath, "r");
    } catch (error) {
      rethrowIfUnreadable(name, error);

      if (!isMissingPathError(error)) {
        throw error;
      }

      options.skipped.push({
        path: name,
        reason: DELETED_DURING_EXPORT,
      });

      return;
    }

    try {
      await addEntry(
        name,
        async (entry) => {
          let fileBytes = 0;

          const input = handle.createReadStream({
            highWaterMark: 64 * 1024,
          });

          for await (const chunk of input) {
            fileBytes += chunk.byteLength;

            if (fileBytes > options.limits.entryBytes) {
              throw new NakamaApiError(
                `Cannot export a restorable backup: Archive entry ${name} exceeds the ${megabytes(options.limits.entryBytes)} limit. Use a filesystem or volume backup instead.`,
                413
              );
            }

            if (
              uncompressedTotal + fileBytes >
              options.limits.uncompressedBytes
            ) {
              throw new NakamaApiError(
                `Cannot export a restorable backup: Archive exceeds the ${megabytes(options.limits.uncompressedBytes)} uncompressed limit. Use a filesystem or volume backup instead.`,
                413
              );
            }

            entry.push(chunk, false);

            if (zipError) {
              throw zipError;
            }

            if (out.writableNeedDrain) {
              await once(out, "drain");
            }
          }

          entry.push(new Uint8Array(0), true);

          if (zipError) {
            throw zipError;
          }

          uncompressedTotal += fileBytes;
        },
        compress
      );
    } finally {
      await handle.close();
    }
  };

  try {
    for (const file of options.files) {
      if (CONFIG_FILES.has(file.relativePath)) {
        let data: Buffer;

        try {
          data = await readFile(file.absolutePath);
        } catch (error) {
          rethrowIfUnreadable(file.relativePath, error);
          throw error;
        }

        if (
          /(?:^|\n)\s*(?:api_key|password)\s*=/m.test(data.toString("utf8"))
        ) {
          throw new NakamaApiError(
            "Legacy plaintext secrets must migrate before export.",
            409
          );
        }

        await addBufferEntry(file.relativePath, data, true);
        continue;
      }

      await addFileEntry(
        file.relativePath,
        file.absolutePath,
        isCompressibleFile(file.relativePath)
      );
    }

    for (const [relativePath, absolutePath] of options.snapshots) {
      await addFileEntry(
        relativePath,
        absolutePath,
        isCompressibleFile(relativePath)
      );
    }

    const topLevelPathSet = new Set<string>();

    for (const path of writtenPaths) {
      const first = path.split("/")[0];

      if (first) {
        topLevelPathSet.add(first);
      }
    }

    const topLevelPaths = [...topLevelPathSet].sort();

    const manifest: DataExportManifest = {
      apiVersion: NAKAMA_API_VERSION,
      createdAt: options.createdAt,
      fileCount: writtenPaths.length,
      kind: "nakama-export",
      skipped: options.skipped,
      sourceRootName: basename(options.rootDir) || ".nakama",
      topLevelPaths,
      totalBytes: uncompressedTotal,
      version: NAKAMA_EXPORT_FORMAT_VERSION,
    };

    await addBufferEntry(
      NAKAMA_EXPORT_MANIFEST,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      true
    );

    zip.end();

    const closed = Promise.withResolvers<void>();
    out.once("error", closed.reject);
    out.end(() => closed.resolve());
    await closed.promise;

    if (zipError) {
      throw zipError;
    }

    return manifest;
  } catch (error) {
    out.destroy();
    throw error;
  }
}

const COMPRESSIBLE_FILE =
  /\.(?:csv|html|ini|js|json|jsonl|log|md|ts|txt|xml|yaml|yml)$/i;

function isCompressibleFile(name: string): boolean {
  return COMPRESSIBLE_FILE.test(name);
}

export async function createNakamaUserDataExport(
  databaseAdapter: DatabaseAdapter,
  userId: string,
  options: { now?: Date } = {}
): Promise<CreateUserDataExportResult> {
  const user = await databaseAdapter.getUserById(userId);

  if (!user) {
    throw new NakamaApiError("Not found", 404);
  }

  const memberships = [];

  for (const organization of await databaseAdapter.listOrganizations()) {
    const member = await databaseAdapter.getOrgMember(organization.id, userId);

    if (!member) {
      continue;
    }

    memberships.push({
      joinedAt: member.createdAt,
      organization: {
        archivedAt: organization.archivedAt ?? null,
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      role: member.role,
      userContext: member.userContext ?? null,
    });
  }

  const entries: Record<string, Uint8Array> = {};
  const sessions = [];
  const userSessions = await databaseAdapter.listSessionsForUser(userId);

  for (const session of userSessions) {
    const attachments = [];

    for (const attachment of await databaseAdapter.listAttachmentsForSession(
      session.id
    )) {
      const attachmentPath = `attachments/${attachment.id}`;
      validateArchivePath(attachmentPath);

      const bytes = attachment.orgId
        ? await readAttachmentBytes(
            attachment.orgId,
            attachment.profileId,
            attachment.id
          )
        : null;

      if (bytes) {
        entries[attachmentPath] = bytes;
      }

      attachments.push({
        channel: attachment.channel,
        createdAt: attachment.createdAt,
        filename: attachment.filename,
        id: attachment.id,
        kind: attachment.kind,
        mediaType: attachment.mediaType,
        path: bytes ? attachmentPath : null,
        sizeBytes: attachment.sizeBytes,
      });
    }

    sessions.push({
      agentQuestionnaire: session.agentQuestionnaire,
      agentTodos: session.agentTodos,
      attachments,
      channel: session.channel,
      createdAt: session.createdAt,
      id: session.id,
      messages: await databaseAdapter.listMessagesForSession(session.id),
      model: session.model,
      orgId: session.orgId ?? null,
      pinned: session.pinned ?? false,
      profileId: session.profileId,
      title: session.title,
    });
  }

  const createdAt = (options.now ?? new Date()).toISOString();
  entries[NAKAMA_USER_EXPORT_MANIFEST] = Buffer.from(
    JSON.stringify(
      {
        apiVersion: NAKAMA_API_VERSION,
        createdAt,
        kind: "nakama-user-export",
        memberships,
        sessions,
        user: {
          createdAt: user.createdAt,
          disabledAt: user.disabledAt ?? null,
          email: user.email,
          id: user.id,
          isPlatformAdmin: user.isPlatformAdmin ?? false,
          name: user.name ?? null,
          phone: user.phone ?? null,
          updatedAt: user.updatedAt,
        },
        version: NAKAMA_USER_EXPORT_FORMAT_VERSION,
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    data: Buffer.from(zipSync(entries)),
    filename: `nakama-user-export-${createdAt.replace(/[:.]/g, "-")}.zip`,
  };
}

export async function createNakamaOrgDataExport(
  databaseAdapter: DatabaseAdapter,
  orgId: string,
  options: { now?: Date } = {}
): Promise<CreateUserDataExportResult> {
  const organization = await databaseAdapter.getOrganizationById(orgId);

  if (!organization) {
    throw new NakamaApiError("Not found", 404);
  }

  const entries: Record<string, Uint8Array> = {};
  const members = [];

  for (const member of await databaseAdapter.listOrgMembers(orgId)) {
    const user = await databaseAdapter.getUserById(member.userId);
    members.push({
      joinedAt: member.createdAt,
      role: member.role,
      user: user
        ? {
            createdAt: user.createdAt,
            disabledAt: user.disabledAt ?? null,
            email: user.email,
            id: user.id,
            name: user.name ?? null,
            phone: user.phone ?? null,
            updatedAt: user.updatedAt,
          }
        : { id: member.userId },
      userContext: member.userContext ?? null,
    });
  }

  const profiles = [];

  for (const profile of await databaseAdapter.listProfilesForOrg(orgId)) {
    const soulDir = getProfileSoulDir(orgId, profile.id);

    const artifacts =
      (await pathExists(soulDir)) && !(await isDirectExportPath(soulDir))
        ? []
        : (await listArtifacts(orgId, profile.id)).artifacts;

    const exportedArtifacts = [];

    for (const artifact of artifacts) {
      const archivePath = toZipPath(
        `profiles/${profile.id}/artifacts/${artifact.filename}`
      );

      validateArchivePath(archivePath);
      entries[archivePath] = await readFile(artifact.path);
      exportedArtifacts.push({
        filename: artifact.filename,
        mediaType: artifact.mimeType,
        path: archivePath,
        sizeBytes: artifact.sizeBytes,
        updatedAt: artifact.updatedAt,
      });
    }

    for (const filename of [
      "SOUL.md",
      "STYLE.md",
      "INSTRUCTIONS.md",
      "MEMORY.md",
    ]) {
      const sourcePath = join(soulDir, filename);

      if (
        (await pathExists(sourcePath)) &&
        (await isDirectExportPath(sourcePath))
      ) {
        const archivePath = `profiles/${profile.id}/workspace/${filename}`;
        validateArchivePath(archivePath);
        entries[archivePath] = await readFile(sourcePath);
      }
    }

    await addDirectoryFiles(
      entries,
      getKnowledgeBaseDir(orgId, profile.id),
      `profiles/${profile.id}/knowledge-base`
    );

    const shared = await databaseAdapter.getSharedAgentInstance(
      orgId,
      profile.id
    );

    profiles.push({
      ...profile,
      artifacts: exportedArtifacts,
      sharedAgent: shared
        ? {
            publicationId: shared.publicationId,
            sourceOrgId: shared.sourceOrgId,
            sourceProfileId: shared.sourceProfileId,
          }
        : undefined,
    });
  }

  await addDirectoryFiles(
    entries,
    getOrgKnowledgeBaseDir(orgId),
    "organization/knowledge-base"
  );

  const sessions = [];
  const profileIds = new Set(profiles.map((profile) => profile.id));

  const orgSessions = (await databaseAdapter.listSessions()).filter((session) =>
    profileIds.has(session.profileId)
  );

  for (const { codingWorkspaceRoot: _hostPath, ...session } of orgSessions) {
    const attachments = [];

    for (const attachment of await databaseAdapter.listAttachmentsForSession(
      session.id
    )) {
      const attachmentPath = `attachments/${attachment.id}`;
      validateArchivePath(attachmentPath);

      const sourcePath = getAttachmentFilePath(
        orgId,
        attachment.profileId,
        attachment.id
      );

      const bytes =
        (await pathExists(sourcePath)) && (await isDirectExportPath(sourcePath))
          ? await readAttachmentBytes(
              orgId,
              attachment.profileId,
              attachment.id
            )
          : null;

      if (bytes) {
        entries[attachmentPath] = bytes;
      }

      attachments.push({
        channel: attachment.channel,
        createdAt: attachment.createdAt,
        filename: attachment.filename,
        id: attachment.id,
        kind: attachment.kind,
        mediaType: attachment.mediaType,
        path: bytes ? attachmentPath : null,
        sizeBytes: attachment.sizeBytes,
      });
    }

    sessions.push({
      ...session,
      attachments,
      messages: await databaseAdapter.listMessagesForSession(session.id),
    });
  }

  const automations = [];

  for (const automation of await databaseAdapter.listAutomationsForOrg(orgId)) {
    automations.push({
      ...automation,
      runs: await databaseAdapter.listAutomationRuns(
        automation.id,
        Number.MAX_SAFE_INTEGER
      ),
    });
  }

  const workflows = [];

  for (const workflow of await databaseAdapter.listWorkflowsForOrg(orgId)) {
    const runs = [];

    for (const run of await databaseAdapter.listWorkflowRuns(
      workflow.id,
      Number.MAX_SAFE_INTEGER
    )) {
      runs.push({
        ...run,
        steps: await databaseAdapter.listWorkflowRunSteps(run.id),
      });
    }

    workflows.push({ ...workflow, runs });
  }

  const createdAt = (options.now ?? new Date()).toISOString();
  entries[NAKAMA_ORG_EXPORT_MANIFEST] = Buffer.from(
    JSON.stringify(
      {
        apiVersion: NAKAMA_API_VERSION,
        automations,
        createdAt,
        kind: "nakama-org-export",
        members,
        organization,
        profiles,
        sessions,
        version: NAKAMA_ORG_EXPORT_FORMAT_VERSION,
        workflows,
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    data: Buffer.from(zipSync(entries)),
    filename: `nakama-org-export-${organization.slug}-${createdAt.replace(/[:.]/g, "-")}.zip`,
  };
}

export async function isDirectExportPath(sourcePath: string): Promise<boolean> {
  const rootDir = getUserConfigDir();

  const expected = resolve(
    await realpath(rootDir),
    relative(rootDir, sourcePath)
  );

  return (await realpath(sourcePath)) === expected;
}

async function addDirectoryFiles(
  entries: Record<string, Uint8Array>,
  sourceDir: string,
  archiveDir: string
): Promise<void> {
  if (
    !((await pathExists(sourceDir)) && (await isDirectExportPath(sourceDir)))
  ) {
    return;
  }

  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const archivePath = toZipPath(`${archiveDir}/${entry.name}`);

    if (entry.isDirectory()) {
      await addDirectoryFiles(entries, sourcePath, archivePath);
    } else if (entry.isFile()) {
      validateArchivePath(archivePath);
      entries[archivePath] = await readFile(sourcePath);
    }
  }
}

interface ArchiveValidation {
  archiveFileCount: number;
  archiveTotalBytes: number;
  manifest: DataExportManifest;
  topLevelPaths: string[];
}

async function validateArchiveFile(
  archivePath: string,
  limits: ImportLimits
): Promise<ArchiveValidation> {
  const zipfile = await openZipFile(archivePath);

  try {
    return await validateArchiveEntries(zipfile, limits);
  } finally {
    zipfile.close();
  }
}

/** Reads the whole central directory and rejects before the restore writes a byte. */
async function validateArchiveEntries(
  zipfile: yauzl.ZipFile,
  limits: ImportLimits
): Promise<ArchiveValidation> {
  let entryCount = 0;
  let uncompressedTotal = 0;
  let archiveFileCount = 0;
  let archiveTotalBytes = 0;
  let manifest: DataExportManifest | null = null;
  const names = new Set<string>();
  const topLevelPaths = new Set<string>();

  const done = Promise.withResolvers<void>();
  zipfile.on("error", done.reject);
  zipfile.on("end", () => done.resolve());
  zipfile.on("entry", (entry: ZipEntryInfo) => {
    try {
      entryCount += 1;
      uncompressedTotal += entry.uncompressedSize;
      validateArchivePath(entry.fileName);
      validateArchiveEntryLimits(
        entry.fileName,
        entry.uncompressedSize,
        entryCount,
        uncompressedTotal,
        limits
      );

      // biome-ignore lint/suspicious/noBitwiseOperators: ZIP stores the Unix file mode in the upper 16 bits.
      const mode = (entry.externalFileAttributes >>> 16) & 0xff_ff;

      // biome-ignore lint/suspicious/noBitwiseOperators: S_IFMT and S_IFLNK are bit masks.
      if ((mode & 0o17_0000) === 0o12_0000) {
        throw new NakamaApiError(
          `Archive entry is a symlink: ${entry.fileName}`,
          400
        );
      }

      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new NakamaApiError(
          `Archive entry uses an unsupported compression method: ${entry.fileName}`,
          400
        );
      }

      const key =
        process.platform === "linux"
          ? entry.fileName
          : entry.fileName.toLowerCase();

      if (names.has(key)) {
        throw new NakamaApiError(
          `Archive has duplicate entry: ${entry.fileName}`,
          400
        );
      }

      names.add(key);

      if (entry.fileName === NAKAMA_EXPORT_MANIFEST) {
        void readZipEntryBuffer(zipfile, entry, MAX_MANIFEST_BYTES)
          .then((data) => {
            manifest = parseManifestBuffer(data);
            zipfile.readEntry();
          })
          .catch((error: Error) => {
            zipfile.close();
            done.reject(error);
          });

        return;
      }

      if (!entry.fileName.endsWith("/")) {
        archiveFileCount += 1;
        archiveTotalBytes += entry.uncompressedSize;
        const first = entry.fileName.split("/")[0];

        if (first) {
          topLevelPaths.add(first);
        }
      }

      zipfile.readEntry();
    } catch (error) {
      zipfile.close();
      done.reject(error);
    }
  });

  zipfile.readEntry();
  await done.promise;

  if (!manifest) {
    throw new NakamaApiError("Archive is missing Nakama export manifest.", 400);
  }

  return {
    archiveFileCount,
    archiveTotalBytes,
    manifest,
    topLevelPaths: [...topLevelPaths].sort(),
  };
}

export async function previewNakamaDataImportFile(
  archivePath: string,
  options: PreviewDataImportOptions = {}
): Promise<DataImportPreviewResponse> {
  const rootDir = resolveNakamaRootDir(options.rootDir);
  const limits = options.limits ?? getDataImportLimits();
  const validation = await validateArchiveFile(archivePath, limits);

  return {
    archiveFileCount: validation.archiveFileCount,
    archiveTotalBytes: validation.archiveTotalBytes,
    manifest: validation.manifest,
    topLevelPaths: validation.topLevelPaths,
    willReplaceRoot: await pathExists(rootDir),
  };
}

export async function previewNakamaDataImport(
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: PreviewDataImportOptions = {}
): Promise<DataImportPreviewResponse> {
  const temp = await writeTempImportArchive(toBuffer(archive));

  try {
    return await previewNakamaDataImportFile(temp.path, options);
  } finally {
    await temp.cleanup();
  }
}

// A caller with its own advice for an archive over the cap passes it as tooLargeMessage.
const ARCHIVE_TOO_LARGE = `Import archive must be at most ${megabytes(MAX_IMPORT_ARCHIVE_BYTES)}.`;

export function decodeArchiveRequestData(
  data: string,
  tooLargeMessage = ARCHIVE_TOO_LARGE
): Buffer {
  // Checked before the trim, so an oversized payload is rejected without
  // being copied and then decoded.
  if (data.length > MAX_IMPORT_ARCHIVE_BASE64_CHARS) {
    throw new NakamaApiError(tooLargeMessage, 413);
  }

  const trimmed = data.trim();

  if (!trimmed) {
    throw new NakamaApiError("Import archive data is required.", 400);
  }

  return decryptArchiveIfNeeded(Buffer.from(trimmed, "base64"));
}

// A scheduled backup is encrypted; the raw and the base64 body forms both need it opened.
function decryptArchiveIfNeeded(archive: Buffer): Buffer {
  if (!isEncryptedBackup(archive)) {
    return archive;
  }

  try {
    return decryptBackup(
      archive,
      decodeSecretsKey(process.env.NAKAMA_SECRETS_KEY ?? "")
    );
  } catch {
    throw new NakamaApiError(
      "Cannot decrypt this backup with NAKAMA_SECRETS_KEY.",
      400
    );
  }
}

/** Checks and opens a raw ZIP body, the form a browser sends. */
export function decodeArchiveRequestBytes(
  archive: Buffer,
  tooLargeMessage = ARCHIVE_TOO_LARGE
): Buffer {
  if (archive.length > MAX_IMPORT_ARCHIVE_BYTES) {
    throw new NakamaApiError(tooLargeMessage, 413);
  }

  if (archive.length === 0) {
    throw new NakamaApiError("Import archive data is required.", 400);
  }

  return decryptArchiveIfNeeded(archive);
}

function megabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}

const MAX_MANIFEST_BYTES = 1024 * 1024;

export async function spoolImportArchive(
  body: ReadableStream<Uint8Array>,
  options: {
    limits: ImportLimits;
    rootDir?: string;
    signal?: AbortSignal;
    tooLargeMessage?: string;
  }
): Promise<{ cleanup: () => Promise<void>; path: string }> {
  const rootDir = resolveNakamaRootDir(options.rootDir);
  await mkdir(rootDir, { mode: 0o700, recursive: true });
  const dir = await mkdtemp(join(rootDir, UPLOAD_PREFIX));
  const path = join(dir, "archive.zip");
  const writer = Bun.file(path).writer();
  let bytes = 0;

  try {
    await body.pipeTo(
      new WritableStream<Uint8Array>({
        async write(chunk) {
          bytes += chunk.byteLength;

          if (bytes > options.limits.archiveBytes) {
            throw new NakamaApiError(
              options.tooLargeMessage ??
                `Import archive must be at most ${megabytes(options.limits.archiveBytes)}.`,
              413
            );
          }

          await writer.write(chunk);
        },
      }),
      { signal: options.signal }
    );
    await writer.end();
  } catch (error) {
    try {
      await writer.end();
    } catch {
      // The original failure is the one that matters.
    }

    await rm(dir, { force: true, recursive: true });
    throw error;
  }

  let cleaned = false;

  return {
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      await rm(dir, { force: true, recursive: true });
    },
    path,
  };
}

/** Removes leftovers from a crash or container restart. Runs before serving. */
export async function cleanupDataPortabilityTempDirs(
  rootDir?: string
): Promise<void> {
  const root = resolveNakamaRootDir(rootDir);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

  const prefixes = [
    RESTORE_PREFIX,
    BACKUP_PREFIX,
    EXPORT_PREFIX,
    UPLOAD_PREFIX,
  ];

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      prefixes.some((prefix) => entry.name.startsWith(prefix))
    ) {
      await rm(join(root, entry.name), { force: true, recursive: true });
    }
  }
}

/** Opens an uploaded archive, decrypting a scheduled backup into a sibling file. */
export async function openImportArchive(
  archivePath: string
): Promise<{ cleanup: () => Promise<void>; path: string }> {
  const handle = await open(archivePath, "r");
  const header = Buffer.alloc(28);

  try {
    await handle.read(header, 0, header.byteLength, 0);
  } finally {
    await handle.close();
  }

  if (!isEncryptedBackup(header)) {
    return { cleanup: async () => undefined, path: archivePath };
  }

  const dir = await mkdtemp(join(dirname(archivePath), UPLOAD_PREFIX));
  const path = join(dir, "archive.zip");

  try {
    await decryptBackupFile(
      archivePath,
      path,
      decodeSecretsKey(process.env.NAKAMA_SECRETS_KEY ?? "")
    );
  } catch {
    await rm(dir, { force: true, recursive: true });
    throw new NakamaApiError(
      "Cannot decrypt this backup with NAKAMA_SECRETS_KEY.",
      400
    );
  }

  let cleaned = false;

  return {
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      await rm(dir, { force: true, recursive: true });
    },
    path,
  };
}

export async function writeTempImportArchive(
  data: Buffer
): Promise<{ cleanup: () => Promise<void>; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "nakama-import-"));
  const path = join(dir, "archive.zip");
  await writeFile(path, data, { mode: 0o600 });

  let cleaned = false;

  return {
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      await rm(dir, { force: true, recursive: true });
    },
    path,
  };
}

export async function restoreNakamaDataImport(
  archive: Buffer | Uint8Array | ArrayBuffer,
  options: RestoreDataImportOptions
): Promise<RestoreDataImportResponse> {
  const temp = await writeTempImportArchive(toBuffer(archive));

  try {
    return await restoreNakamaDataImportFile(temp.path, options);
  } finally {
    await temp.cleanup();
  }
}

export async function restoreNakamaDataImportFile(
  archivePath: string,
  options: RestoreDataImportOptions
): Promise<RestoreDataImportResponse> {
  if (!options.confirm) {
    throw new NakamaApiError("Restore confirmation is required.", 400);
  }

  const rootDir = resolveNakamaRootDir(options.rootDir);
  const limits = options.limits ?? getDataImportLimits();
  const validation = await validateArchiveFile(archivePath, limits);
  const zipfile = await openZipFile(archivePath);

  const liveDatabasePath = pathInsideRoot(
    rootDir,
    resolveConfiguredDatabasePath(rootDir, options.databasePath)
  );

  // Live runtime state, not user data: replacing the pm2 home orphans the
  // daemon, and replacing the log loses this session's diagnostics. Only the
  // desktop app keeps these in its data root.
  const desktop = process.env.NAKAMA_DESKTOP === "1";
  const keptEntries = new Set<string>();

  for (const live of [
    options.pm2Home === undefined && desktop
      ? process.env.PM2_HOME
      : options.pm2Home,
    options.serverLog === undefined && desktop
      ? process.env.NAKAMA_SERVER_LOG
      : options.serverLog,
  ]) {
    const inside = pathInsideRoot(rootDir, live);
    const entry = inside ? relative(rootDir, inside) : "";

    // Keep only an entry that is itself the live state, never a shared parent.
    if (entry && !entry.includes(sep)) {
      keptEntries.add(entry);
    }
  }

  // Stage and back up inside rootDir so Docker volume mounts (e.g. /nakama/data)
  // are never renamed — rename(2) on a mount point returns EBUSY.
  await mkdir(rootDir, { mode: 0o700, recursive: true });
  const stagingParent = await mkdtemp(join(rootDir, RESTORE_PREFIX));
  const stagedRoot = join(stagingParent, "root");
  const backupRoot = join(rootDir, `${BACKUP_PREFIX}${Date.now()}`);
  const backedUpEntries: string[] = [];
  let backupComplete = false;
  let restoreCommitted = false;
  let replaceStarted = false;

  try {
    await mkdir(stagedRoot, { mode: 0o700, recursive: true });
    const extracted = await extractArchiveEntries(zipfile, stagedRoot);
    const manifest = validation.manifest;
    const restoredFileCount = extracted.restoredFileCount;

    await moveArchiveDatabaseToLiveLayout(
      stagedRoot,
      rootDir,
      liveDatabasePath
    );

    const stagedDatabasePath = liveDatabasePath
      ? join(stagedRoot, relative(rootDir, liveDatabasePath))
      : null;

    // Also sanitize known archive layouts when the live install has no matching
    // database yet. An older backup must not retain usable key storage.
    const stagedDatabases = new Set([
      stagedDatabasePath,
      ...MAIN_DATABASE_LAYOUTS.map((layout) => join(stagedRoot, layout)),
      join(stagedRoot, "nakama.db"),
      join(stagedRoot, "nakama.sqlite"),
    ]);

    await retireAppUserData(stagedRoot, null);

    for (const candidate of stagedDatabases) {
      if (candidate && (await pathExists(candidate))) {
        await retireAppUserData(stagedRoot, candidate);
      }
    }

    const secretDatabasePath =
      stagedDatabasePath && (await pathExists(stagedDatabasePath))
        ? stagedDatabasePath
        : (
            await Promise.all(
              stagedDatabases
                .values()
                .filter(Boolean)
                .map(async (candidate) =>
                  candidate && (await pathExists(candidate)) ? candidate : null
                )
                .toArray()
            )
          ).find(Boolean);

    const hasLegacySecrets = (
      await Promise.all(
        ["config.ini", "composio/config.ini"].map(async (name) => {
          const file = join(stagedRoot, name);

          return (
            (await pathExists(file)) &&
            /(?:^|\n)\s*(?:api_key|password)\s*=/m.test(
              await readFile(file, "utf8")
            )
          );
        })
      )
    ).some(Boolean);

    if (secretDatabasePath || hasLegacySecrets) {
      const stagedDatabase = await createSqliteDatabase(
        `file:${secretDatabasePath ?? join(stagedRoot, "sqlite", "nakama.sqlite")}`
      );

      const secrets = new ManagedSecrets(stagedDatabase.adapter);

      try {
        // Named check: migrateLegacyFiles re-runs it, but its plain Error would
        // reach restore clients as a generic "unexpected server error".
        try {
          await secrets.checkIntegrity();
        } catch (error) {
          // formatServerError only logs non-NakamaApiError causes; log here so
          // the underlying failure stays diagnosable.
          console.error("Restored secrets integrity check failed:", error);
          throw new NakamaApiError(
            "Saved secrets in this backup cannot be decrypted with this install's NAKAMA_SECRETS_KEY. Re-enter provider keys after restore, or remove saved secrets from the backup.",
            400
          );
        }

        await secrets.migrateLegacyFiles(stagedRoot);
      } finally {
        stagedDatabase.release();
      }
    }

    if (options.beforeReplace) {
      // Set first: a hook that throws may already have released the handle.
      replaceStarted = true;
      await options.beforeReplace();
    }

    // Read after requests drain, so a publication revoked during staging stays revoked.
    const permittedPublications = new Set<string>();

    if (liveDatabasePath && (await pathExists(liveDatabasePath))) {
      const live = new Database(liveDatabasePath, { readonly: true });

      try {
        if (
          live
            .query(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='org_shared_resources'"
            )
            .get()
        ) {
          const publications = live
            .query<
              {
                id: string;
                org_id: string;
                resource_kind: string;
                resource_id: string;
              },
              []
            >(
              "SELECT id, org_id, resource_kind, resource_id FROM org_shared_resources"
            )
            .all();

          for (const publication of publications) {
            permittedPublications.add(
              JSON.stringify([
                publication.id,
                publication.org_id,
                publication.resource_kind,
                publication.resource_id,
              ])
            );
          }
        }
      } finally {
        live.close();
      }
    }

    for (const candidate of stagedDatabases) {
      if (!(candidate && (await pathExists(candidate)))) {
        continue;
      }

      const staged = new Database(candidate);

      try {
        staged.exec("PRAGMA synchronous = EXTRA");

        if (
          staged
            .query(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='org_shared_resources'"
            )
            .get()
        ) {
          staged
            .transaction(() => {
              const publications = staged
                .query<
                  {
                    id: string;
                    org_id: string;
                    resource_kind: string;
                    resource_id: string;
                  },
                  []
                >(
                  "SELECT id, org_id, resource_kind, resource_id FROM org_shared_resources"
                )
                .all();

              const remove = staged.query(
                "DELETE FROM org_shared_resources WHERE id = ?"
              );

              for (const publication of publications) {
                if (
                  !permittedPublications.has(
                    JSON.stringify([
                      publication.id,
                      publication.org_id,
                      publication.resource_kind,
                      publication.resource_id,
                    ])
                  )
                ) {
                  remove.run(publication.id);
                }
              }
            })
            .immediate();
        }
      } finally {
        staged.close();
      }
    }

    const existingEntries = await listMovableTopLevelEntries(
      rootDir,
      keptEntries
    );

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
      if (!keptEntries.has(name)) {
        await movePath(join(stagedRoot, name), join(rootDir, name));
      }
    }

    restoreCommitted = true;
    await finalizeRestoredPlugins(
      rootDir,
      liveDatabasePath ?? options.databasePath
    );

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
          for (const name of await listMovableTopLevelEntries(
            rootDir,
            keptEntries
          )) {
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

    if (replaceStarted) {
      try {
        await options.afterFailedReplace?.();
      } catch {
        // Surface the restore failure, not the reopen failure.
      }
    }

    throw error;
  } finally {
    try {
      zipfile.close();
    } catch {
      // Already closed by autoClose.
    }

    await rm(stagingParent, { force: true, recursive: true });
  }
}

async function inventoryConfigRoot(
  rootDir: string,
  snapshots: ReadonlyMap<string, string>
): Promise<{
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
    let entries: Dirent[];

    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      rethrowIfUnreadable(toZipPath(relative(rootDir, currentDir)), error);

      if (!isMissingPathError(error) || currentDir === rootDir) {
        throw error;
      }

      skipped.push({
        path: toZipPath(relative(rootDir, currentDir)),
        reason: DELETED_DURING_EXPORT,
      });

      return;
    }

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = toZipPath(relative(rootDir, absolutePath));

      const skipReason = skipRelativePathReason(relativePath, snapshots);

      if (skipReason) {
        const first = firstSegment(relativePath);

        if (
          !(
            first.startsWith(PLUGIN_SNAPSHOT_PREFIX) ||
            first.startsWith(EXPORT_PREFIX) ||
            first.startsWith(UPLOAD_PREFIX)
          )
        ) {
          skipped.push({
            path: relativePath,
            reason: skipReason,
          });
        }

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

      files.push({ absolutePath, relativePath });
    }
  }
}

interface ExtractedArchive {
  restoredFileCount: number;
}

/** Extracts the already-validated entries. The first pass rejected any unsafe entry. */
async function extractArchiveEntries(
  zipfile: yauzl.ZipFile,
  stagedRoot: string
): Promise<ExtractedArchive> {
  let restoredFileCount = 0;

  const done = Promise.withResolvers<void>();
  zipfile.on("error", done.reject);
  zipfile.on("end", () => done.resolve());
  zipfile.on("entry", (entry: ZipEntryInfo) => {
    void (async () => {
      if (entry.fileName.endsWith("/")) {
        await mkdir(
          resolveRestoredTarget(stagedRoot, entry.fileName.replace(/\/$/, "")),
          { mode: 0o700, recursive: true }
        );
        zipfile.readEntry();

        return;
      }

      if (entry.fileName === NAKAMA_EXPORT_MANIFEST) {
        zipfile.readEntry();

        return;
      }

      await extractZipEntry(zipfile, entry, stagedRoot);
      restoredFileCount += 1;
      zipfile.readEntry();
    })().catch((error: Error) => {
      zipfile.close();
      done.reject(error);
    });
  });

  zipfile.readEntry();
  await done.promise;

  return { restoredFileCount };
}

async function extractZipEntry(
  zipfile: yauzl.ZipFile,
  entry: ZipEntryInfo,
  stagedRoot: string
): Promise<void> {
  const target = resolveRestoredTarget(stagedRoot, entry.fileName);
  await mkdir(dirname(target), { mode: 0o700, recursive: true });

  let crc = 0;
  let bytes = 0;

  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;

      if (bytes > entry.uncompressedSize) {
        callback(
          new NakamaApiError(
            `Archive entry ${entry.fileName} has the wrong size.`,
            400
          )
        );

        return;
      }

      crc = crc32(chunk, crc);
      callback(null, chunk);
    },
  });

  const readStream = await openZipReadStream(zipfile, entry);
  await pipeline(
    readStream,
    verify,
    createWriteStream(target, { mode: 0o600 })
  );

  if (bytes !== entry.uncompressedSize) {
    throw new NakamaApiError(
      `Archive entry ${entry.fileName} has the wrong size.`,
      400
    );
  }

  // biome-ignore lint/suspicious/noBitwiseOperators: CRC-32 is an unsigned 32-bit value.
  if (crc >>> 0 !== entry.crc32 >>> 0) {
    throw new NakamaApiError(
      `Archive entry ${entry.fileName} failed its checksum.`,
      400
    );
  }
}

function openZipFile(path: string): Promise<yauzl.ZipFile> {
  const result = Promise.withResolvers<yauzl.ZipFile>();

  yauzl.open(
    path,
    {
      decodeStrings: true,
      lazyEntries: true,
      // Our own byte-count check gives a clearer error and runs after the
      // declared-size caps, so yauzl must not reject the entry first.
      validateEntrySizes: false,
    },
    (error, zipfile) => {
      if (error) {
        result.reject(
          error instanceof NakamaApiError
            ? error
            : new NakamaApiError("Invalid ZIP archive.", 400)
        );

        return;
      }

      result.resolve(zipfile);
    }
  );

  return result.promise;
}

function openZipReadStream(
  zipfile: yauzl.ZipFile,
  entry: ZipEntryInfo
): Promise<Readable> {
  const result = Promise.withResolvers<Readable>();

  zipfile.openReadStream(entry, (error, stream) => {
    if (error) {
      result.reject(error);

      return;
    }

    result.resolve(stream);
  });

  return result.promise;
}

async function readZipEntryBuffer(
  zipfile: yauzl.ZipFile,
  entry: ZipEntryInfo,
  maxBytes: number
): Promise<Buffer> {
  const stream = await openZipReadStream(zipfile, entry);
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of stream) {
    size += chunk.length;

    if (size > maxBytes) {
      throw new NakamaApiError(
        `Archive entry ${entry.fileName} is too large.`,
        400
      );
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function parseManifestBuffer(data: Buffer): DataExportManifest {
  let manifest: DataExportManifest;

  try {
    manifest = parseDataExportManifest(JSON.parse(data.toString("utf8")));
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw error;
    }

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

function resolveRestoredTarget(rootDir: string, name: string): string {
  validateArchivePath(name);
  const target = resolve(rootDir, name);
  const relativeTarget = relative(rootDir, target);

  if (
    relativeTarget.startsWith("..") ||
    isAbsolute(relativeTarget) ||
    relativeTarget === ""
  ) {
    throw new NakamaApiError(
      `Archive entry escapes restore root: ${name}`,
      400
    );
  }

  return target;
}

function validateArchiveEntryLimits(
  name: string,
  size: number,
  entryCount: number,
  uncompressedTotal: number,
  limits: ImportLimits
): void {
  if (entryCount > limits.entries) {
    throw new NakamaApiError(
      `Archive exceeds the ${limits.entries} entry limit.`,
      400
    );
  }

  if (size > limits.entryBytes) {
    throw new NakamaApiError(
      `Archive entry ${name} exceeds the ${megabytes(limits.entryBytes)} limit.`,
      400
    );
  }

  if (uncompressedTotal > limits.uncompressedBytes) {
    throw new NakamaApiError(
      `Archive exceeds the ${megabytes(limits.uncompressedBytes)} uncompressed limit.`,
      400
    );
  }
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

  if (process.platform === "win32" && path.includes(":")) {
    throw new NakamaApiError(
      `Archive entry cannot name an NTFS alternate data stream: ${path}`,
      400
    );
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

  if (
    first.startsWith(RESTORE_PREFIX) ||
    first.startsWith(BACKUP_PREFIX) ||
    first.startsWith(EXPORT_PREFIX) ||
    first.startsWith(UPLOAD_PREFIX)
  ) {
    throw new NakamaApiError(
      `Archive entry uses a reserved restore path: ${path}`,
      400
    );
  }
}

function toZipPath(path: string): string {
  return path.split(sep).join("/");
}

function firstSegment(path: string): string {
  return path.split("/")[0] ?? "";
}

function skipRelativePathReason(
  path: string,
  snapshots: ReadonlyMap<string, string>
): string | null {
  const parts = path.split("/");
  const first = parts[0] ?? "";

  if (
    first === NAKAMA_EXPORT_MANIFEST ||
    (parts[0] === "orgs" && parts[2] === "meet" && parts[3] === "audio") ||
    first.startsWith(RESTORE_PREFIX) ||
    first.startsWith(BACKUP_PREFIX) ||
    first.startsWith(EXPORT_PREFIX) ||
    first.startsWith(UPLOAD_PREFIX) ||
    first.startsWith(PLUGIN_SNAPSHOT_PREFIX)
  ) {
    return "Internal data-portability temporary path.";
  }

  if (
    parts[0] === "orgs" &&
    parts[2] === "plugins" &&
    parts[4] === "workers" &&
    parts[6] === "cache"
  ) {
    return "Re-downloadable plugin worker cache is excluded.";
  }

  if (parts[0] === "plugins" && parts[1] === ".staging") {
    return "Transient plugin package staging is excluded.";
  }

  if (
    (path.endsWith("-wal") || path.endsWith("-shm")) &&
    snapshots.has(path.slice(0, -4))
  ) {
    return "Database sidecars are represented by completed snapshots.";
  }

  // Litestream keeps `.<db>-litestream/` next to `<db>`.
  const last = parts.at(-1) ?? "";

  if (
    last.startsWith(".") &&
    last.endsWith(LITESTREAM_SUFFIX) &&
    snapshots.has(
      [...parts.slice(0, -1), last.slice(1, -LITESTREAM_SUFFIX.length)].join(
        "/"
      )
    )
  ) {
    return "Litestream replica state is excluded; the database is a completed snapshot.";
  }

  if (snapshots.has(path)) {
    return "Live databases are replaced by completed snapshots.";
  }

  return null;
}

async function snapshotOrgPluginDatabases(
  rootDir: string,
  snapshotParent: string
): Promise<Map<string, string>> {
  const snapshots = new Map<string, string>();
  const orgsDir = join(rootDir, "orgs");

  for (const org of await readDirentsIfPresent(rootDir, orgsDir)) {
    if (!org.isDirectory()) {
      continue;
    }

    const meetDirectory = join(orgsDir, org.name, "meet");
    const meetDatabase = join(meetDirectory, "meetings.sqlite");

    if (await pathExists(meetDatabase)) {
      const relativePath = toZipPath(relative(rootDir, meetDatabase));
      const target = join(snapshotParent, relativePath);
      await snapshotDatabaseInto(rootDir, meetDatabase, target);
      snapshots.set(relativePath, target);
    }

    const pluginsDir = join(orgsDir, org.name, "plugins");

    for (const plugin of await readDirentsIfPresent(rootDir, pluginsDir)) {
      if (!plugin.isDirectory()) {
        continue;
      }

      const dbDir = join(pluginsDir, plugin.name, "db");

      for (const entry of await readDirentsIfPresent(rootDir, dbDir)) {
        if (!(entry.isFile() && entry.name.endsWith(".sqlite"))) {
          continue;
        }

        const relativePath = toZipPath(
          relative(rootDir, join(dbDir, entry.name))
        );

        if (!ORG_PLUGIN_SQLITE.test(relativePath)) {
          continue;
        }

        const target = join(snapshotParent, relativePath);
        await snapshotDatabaseInto(rootDir, join(dbDir, entry.name), target);
        snapshots.set(relativePath, target);
      }
    }
  }

  return snapshots;
}

async function finalizeRestoredPlugins(
  rootDir: string,
  databasePath?: string | null
): Promise<void> {
  await quarantineInvalidPluginReleases(rootDir);

  const candidates = [
    databasePath ? resolve(databasePath) : "",
    join(rootDir, "data/sqlite/nakama.sqlite"),
    join(rootDir, "nakama.db"),
  ].filter(Boolean);

  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate) || !(await pathExists(candidate))) {
      continue;
    }

    seen.add(candidate);
    await disableRestoredOrgPlugins(candidate);
  }
}

async function disableRestoredOrgPlugins(databasePath: string): Promise<void> {
  const { Database } = await import("bun:sqlite");
  let db: InstanceType<typeof Database>;

  try {
    db = new Database(databasePath);
  } catch {
    return;
  }

  try {
    db.exec("PRAGMA synchronous = EXTRA");
    // SAFETY: This query returns one named column, `name`.

    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'org_plugins'"
      )
      .all() as Array<{ name: string }>;

    if (tables.length === 0) {
      return;
    }

    db.run(
      `UPDATE org_plugins
       SET lifecycle_state = 'disabled',
           pending_operation = NULL,
           revision = revision + 1,
           updated_at = ?
       WHERE lifecycle_state != 'retained'`,
      [new Date().toISOString()]
    );
  } finally {
    db.close(true);
  }
}

function parseDataExportManifest<T>(input: T): DataExportManifest {
  if (!(input instanceof Object)) {
    throw new NakamaApiError(
      "Nakama export manifest has an invalid shape.",
      400
    );
  }

  const record = new Map(Object.entries(input));
  const skipped = record.get("skipped");
  const version = record.get("version");
  const apiVersion = record.get("apiVersion");
  const createdAt = record.get("createdAt");
  const fileCount = record.get("fileCount");
  const sourceRootName = record.get("sourceRootName");
  const topLevelPaths = record.get("topLevelPaths");
  const totalBytes = record.get("totalBytes");

  if (
    !(
      record.get("kind") === "nakama-export" &&
      isNumber(version) &&
      (apiVersion === undefined || apiVersion === NAKAMA_API_VERSION) &&
      (createdAt === undefined || isString(createdAt)) &&
      (fileCount === undefined || isNumber(fileCount)) &&
      (skipped === undefined ||
        (Array.isArray(skipped) && skipped.every(isDataExportSkippedItem))) &&
      (sourceRootName === undefined || isString(sourceRootName)) &&
      (topLevelPaths === undefined || isStringArray(topLevelPaths)) &&
      (totalBytes === undefined || isNumber(totalBytes))
    )
  ) {
    throw new NakamaApiError(
      "Nakama export manifest has an invalid shape.",
      400
    );
  }

  return {
    apiVersion: NAKAMA_API_VERSION,
    createdAt: isString(createdAt) ? createdAt : "",
    fileCount: isNumber(fileCount) ? fileCount : 0,
    kind: "nakama-export",
    skipped: Array.isArray(skipped) ? skipped : [],
    sourceRootName: isString(sourceRootName) ? sourceRootName : "",
    topLevelPaths: isStringArray(topLevelPaths) ? topLevelPaths : [],
    totalBytes: isNumber(totalBytes) ? totalBytes : 0,
    version,
  };
}

function isDataExportSkippedItem<T>(input: T): boolean {
  if (!(input instanceof Object)) {
    return false;
  }

  const item = new Map(Object.entries(input));

  return isString(item.get("path")) && isString(item.get("reason"));
}

function isStringArray<T>(input: T): input is T & string[] {
  return Array.isArray(input) && input.every(isString);
}

function isNumber<T>(input: T): input is T & number {
  return (
    Object.prototype.toString.call(input) === "[object Number]" &&
    Number.isFinite(input)
  );
}

/** ENOTDIR: a file took the place of a directory segment. Both mean "gone". */
function isMissingPathError<T>(error: T): boolean {
  const code = getNodeErrorCode(error);

  return code === "ENOENT" || code === "ENOTDIR";
}

function isPermissionError<T>(error: T): boolean {
  const code = getNodeErrorCode(error);

  return code === "EACCES" || code === "EPERM";
}

/**
 * Keeps failing: a backup that skips what it cannot read looks complete but
 * is not. An empty path is the data root itself. On Windows, EPERM can also
 * mean another program holds the file open.
 */
function rethrowIfUnreadable<T>(relativePath: string, error: T): void {
  if (isPermissionError(error)) {
    throw new NakamaApiError(
      `Cannot export a restorable backup: the server cannot read ${relativePath || "the data folder"}. Fix its owner or permissions, close the program that uses it, or remove it, then try again.`,
      409
    );
  }
}

/**
 * bun:sqlite reports a denied open only as SQLITE_CANTOPEN ("unable to open
 * database file"), without the OS error, so ask the filesystem why it failed.
 */
async function snapshotDatabaseInto(
  rootDir: string,
  sourcePath: string,
  targetPath: string
): Promise<void> {
  try {
    await vacuumPluginDatabaseInto(sourcePath, targetPath);
  } catch (error) {
    await access(sourcePath, constants.R_OK).catch((accessError: Error) =>
      rethrowIfUnreadable(toZipPath(relative(rootDir, sourcePath)), accessError)
    );

    throw error;
  }
}

async function readDirentsIfPresent(
  rootDir: string,
  dir: string
): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    rethrowIfUnreadable(toZipPath(relative(rootDir, dir)), error);

    throw error;
  }
}

function getNodeErrorCode<T>(error: T): string | undefined {
  if (!(error instanceof Error && "code" in error)) {
    return;
  }

  const code = error.code;

  return isString(code) ? code : undefined;
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
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

function pathInsideRoot(
  rootDir: string,
  path: string | null | undefined
): string | null {
  if (!path || path === ":memory:") {
    return null;
  }

  const absolute = resolve(path);
  const relativePath = relative(rootDir, absolute);

  return relativePath &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
    ? absolute
    : null;
}

/**
 * An archive from the other layout would otherwise restore its database where
 * this install never reads it, and the reopen creates an empty one instead.
 */
async function moveArchiveDatabaseToLiveLayout(
  stagedRoot: string,
  rootDir: string,
  liveDatabasePath: string | null
): Promise<void> {
  if (!liveDatabasePath) {
    return;
  }

  const liveLayout = relative(rootDir, liveDatabasePath).split(sep).join("/");
  const target = join(stagedRoot, liveLayout);

  if (
    !MAIN_DATABASE_LAYOUTS.includes(liveLayout) ||
    (await pathExists(target))
  ) {
    return;
  }

  for (const layout of MAIN_DATABASE_LAYOUTS) {
    const archived = join(stagedRoot, layout);

    if (layout !== liveLayout && (await pathExists(archived))) {
      await mkdir(dirname(target), { mode: 0o700, recursive: true });
      await rename(archived, target);

      return;
    }
  }
}

async function listMovableTopLevelEntries(
  rootDir: string,
  keptEntries: ReadonlySet<string>
): Promise<string[]> {
  const entries = await readdir(rootDir);

  return entries.filter(
    (name) =>
      !(
        keptEntries.has(name) ||
        name.startsWith(RESTORE_PREFIX) ||
        name.startsWith(BACKUP_PREFIX) ||
        name.startsWith(EXPORT_PREFIX) ||
        name.startsWith(UPLOAD_PREFIX) ||
        name.startsWith(PLUGIN_SNAPSHOT_PREFIX)
      )
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

function isRetryableMoveError(cause: unknown): boolean {
  if (!(cause instanceof Object && "code" in cause)) {
    return false;
  }

  const code = cause.code;

  return code === "EBUSY" || code === "EXDEV" || code === "EPERM";
}
