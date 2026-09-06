import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  ensureDir,
  getPluginReleaseDir,
  getPluginStagingRootDir,
  PLUGIN_MANIFEST_FILENAME,
  type PluginManifest,
  pathExists,
  validatePluginManifest,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_PATH_BYTES = 240;
const ZIP64_SENTINEL = 0xff_ff_ff_ff;
const EOCD_SIGNATURE = 0x06_05_4b_50;
const CD_SIGNATURE = 0x02_01_4b_50;
const UNIX_OS = 3;
const UNIX_IFDIR_MIN = 0x40_00;
const UNIX_IFDIR_MAX = 0x4f_ff;
const UNIX_IFREG_MIN = 0x80_00;
const UNIX_IFREG_MAX = 0x8f_ff;

export type PluginPackageErrorCode =
  | "archive_too_large"
  | "digest_mismatch"
  | "duplicate_entry"
  | "expansion_limit"
  | "invalid_archive"
  | "invalid_manifest"
  | "missing_manifest"
  | "missing_referenced_file"
  | "unsafe_path"
  | "unsupported_entry"
  | "version_conflict";

export class PluginPackageError extends Error {
  readonly code: PluginPackageErrorCode;

  constructor(code: PluginPackageErrorCode) {
    super(code);
    this.name = "PluginPackageError";
    this.code = code;
  }
}

export interface PluginPackagePreview {
  contributions: PluginContributionSummary;
  digest: string;
  manifest: PluginManifest;
}

export interface PluginPackageInstallResult {
  createdAt: string;
  digest: string;
  manifest: PluginManifest;
  pluginId: string;
  releaseDir: string;
  reused: boolean;
  version: string;
}

export interface InstallPluginPackageOptions {
  expectedDigest?: string;
}

interface PluginContributionSummary {
  actionKeys: string[];
  hasDatabase: boolean;
  hasHooks: boolean;
  hasUi: boolean;
  skillKeys: string[];
}

interface CentralDirectoryEntry {
  attrs: number;
  name: string;
  os: number;
  uncompressedSize: number;
}

interface InspectedPackage {
  digest: string;
  files: Map<string, Uint8Array>;
  manifest: PluginManifest;
}

const installLocks = new Map<string, Promise<unknown>>();

export class PluginService {
  private readonly configDir: string;

  constructor(
    private readonly db: DatabaseAdapter,
    configDir: string
  ) {
    if (!isAbsolute(configDir)) {
      throw new Error(
        "configDir must be an absolute path; relative paths resolve against process.cwd() and break plugin isolation."
      );
    }
    this.configDir = configDir;
  }

  async previewPluginPackage(
    archive: Uint8Array
  ): Promise<PluginPackagePreview> {
    const inspected = inspectPluginPackage(archive);
    return toPreview(inspected);
  }

  async installPluginPackage(
    archive: Uint8Array,
    options: InstallPluginPackageOptions = {}
  ): Promise<PluginPackageInstallResult> {
    const inspected = inspectPluginPackage(archive);
    if (
      options.expectedDigest !== undefined &&
      options.expectedDigest !== inspected.digest
    ) {
      throw new PluginPackageError("digest_mismatch");
    }

    const { id, version } = inspected.manifest;
    return withInstallLock(`${id}@${version}`, async () => {
      await cleanupAbandonedStaging(this.configDir);
      try {
        return await this.publishInspectedPackage(inspected);
      } finally {
        await cleanupAbandonedStaging(this.configDir);
      }
    });
  }

  private async publishInspectedPackage(
    inspected: InspectedPackage
  ): Promise<PluginPackageInstallResult> {
    const { digest, manifest } = inspected;
    const releaseDir = getPluginReleaseDir(
      manifest.id,
      manifest.version,
      this.configDir
    );
    const existing = await this.db.getPluginRelease(
      manifest.id,
      manifest.version
    );

    if (existing && existing.digest && existing.digest !== digest) {
      throw new PluginPackageError("version_conflict");
    }

    if (existing?.digest === digest && (await pathExists(releaseDir))) {
      return {
        createdAt: existing.createdAt,
        digest,
        manifest,
        pluginId: manifest.id,
        releaseDir,
        reused: true,
        version: manifest.version,
      };
    }

    if ((await pathExists(releaseDir)) && !existing) {
      await rm(releaseDir, { force: true, recursive: true });
    }

    const stagingDir = join(
      getPluginStagingRootDir(this.configDir),
      randomUUID()
    );
    let published = false;
    try {
      await writePackageTree(stagingDir, inspected.files);
      if (await pathExists(releaseDir)) {
        await rm(stagingDir, { force: true, recursive: true });
      } else {
        await ensureDir(dirname(releaseDir));
        await rename(stagingDir, releaseDir);
        published = true;
      }

      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const result = await this.db.upsertPluginRelease({
        createdAt,
        digest,
        manifest,
        pluginId: manifest.id,
        version: manifest.version,
      });
      if (!result.ok) {
        if (published) {
          await rm(releaseDir, { force: true, recursive: true });
        }
        throw new PluginPackageError("version_conflict");
      }

      return {
        createdAt,
        digest,
        manifest,
        pluginId: manifest.id,
        releaseDir,
        reused: Boolean(existing?.digest === digest && !published),
        version: manifest.version,
      };
    } catch (error) {
      await rm(stagingDir, { force: true, recursive: true });
      if (
        published &&
        !(await this.db.getPluginRelease(manifest.id, manifest.version))
      ) {
        await rm(releaseDir, { force: true, recursive: true });
      }
      throw error;
    }
  }
}

function toPreview(inspected: InspectedPackage): PluginPackagePreview {
  return {
    contributions: {
      actionKeys: inspected.manifest.actions.map((action) => action.key),
      hasDatabase: Boolean(inspected.manifest.database?.migrations.length),
      hasHooks: Boolean(
        inspected.manifest.hooks?.activate ||
          inspected.manifest.hooks?.deactivate
      ),
      hasUi: Boolean(inspected.manifest.ui),
      skillKeys: inspected.manifest.skills.map((skill) => skill.key),
    },
    digest: inspected.digest,
    manifest: inspected.manifest,
  };
}

function inspectPluginPackage(archive: Uint8Array): InspectedPackage {
  if (archive.byteLength > MAX_COMPRESSED_BYTES) {
    throw new PluginPackageError("archive_too_large");
  }

  const central = parseCentralDirectory(archive);
  if (central.length > MAX_FILES) {
    throw new PluginPackageError("expansion_limit");
  }

  const seen = new Set<string>();
  let declaredTotal = 0;
  for (const entry of central) {
    if (Buffer.byteLength(entry.name, "utf8") > MAX_PATH_BYTES) {
      throw new PluginPackageError("unsafe_path");
    }
    const kind = classifyZipEntry(entry);
    if (kind === "other") {
      throw new PluginPackageError("unsupported_entry");
    }
    const normalized = normalizeArchivePath(entry.name);
    if (seen.has(normalized)) {
      throw new PluginPackageError("duplicate_entry");
    }
    seen.add(normalized);
    if (kind === "file") {
      if (entry.uncompressedSize > MAX_FILE_BYTES) {
        throw new PluginPackageError("expansion_limit");
      }
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > MAX_UNCOMPRESSED_BYTES) {
        throw new PluginPackageError("expansion_limit");
      }
    }
  }

  const extracted = extractZipBounded(archive);
  const packageRoot = resolvePackageRoot([...extracted.keys()]);
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of extracted) {
    const relative = toPackageRelativePath(name, packageRoot);
    if (relative === null) {
      continue;
    }
    files.set(relative, data);
  }

  const manifestBytes = files.get(PLUGIN_MANIFEST_FILENAME);
  if (!manifestBytes) {
    throw new PluginPackageError("missing_manifest");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch {
    throw new PluginPackageError("invalid_manifest");
  }

  const validated = validatePluginManifest(parsed);
  if (!validated.ok) {
    throw new PluginPackageError("invalid_manifest");
  }

  assertReferencedFilesExist(validated.manifest, files);

  return {
    digest: digestArchive(archive),
    files,
    manifest: validated.manifest,
  };
}

function extractZipBounded(archive: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let failure: PluginPackageError | undefined;
  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);
  unzipper.register(UnzipPassThrough);
  unzipper.onfile = (file) => {
    if (failure) {
      file.terminate();
      return;
    }
    if (file.name.endsWith("/")) {
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) {
        return;
      }
      if (error) {
        failure = new PluginPackageError("invalid_archive");
        return;
      }
      size += chunk.byteLength;
      total += chunk.byteLength;
      if (size > MAX_FILE_BYTES || total > MAX_UNCOMPRESSED_BYTES) {
        failure = new PluginPackageError("expansion_limit");
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        normalizeArchivePath(file.name);
        files.set(file.name, concatChunks(chunks));
      }
    };
    try {
      file.start();
    } catch {
      failure = new PluginPackageError("unsupported_entry");
    }
  };

  try {
    unzipper.push(archive, true);
  } catch {
    throw new PluginPackageError("invalid_archive");
  }
  if (failure) {
    throw failure;
  }
  return files;
}

function parseCentralDirectory(archive: Uint8Array): CentralDirectoryEntry[] {
  const eocd = findEocdOffset(archive);
  const totalEntries = readU16(archive, eocd + 10);
  const cdSize = readU32(archive, eocd + 12);
  const cdOffset = readU32(archive, eocd + 16);
  if (cdOffset === ZIP64_SENTINEL || cdSize === ZIP64_SENTINEL) {
    throw new PluginPackageError("invalid_archive");
  }
  if (cdOffset + cdSize > archive.byteLength) {
    throw new PluginPackageError("invalid_archive");
  }

  const entries: CentralDirectoryEntry[] = [];
  let cursor = cdOffset;
  const end = cdOffset + cdSize;
  while (cursor < end) {
    if (readU32(archive, cursor) !== CD_SIGNATURE) {
      throw new PluginPackageError("invalid_archive");
    }
    const versionMadeBy = readU16(archive, cursor + 4);
    const nameLength = readU16(archive, cursor + 28);
    const extraLength = readU16(archive, cursor + 30);
    const commentLength = readU16(archive, cursor + 32);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > end) {
      throw new PluginPackageError("invalid_archive");
    }
    entries.push({
      attrs: readU32(archive, cursor + 38),
      name: Buffer.from(archive.subarray(nameStart, nameEnd)).toString("utf8"),
      os: Math.floor(versionMadeBy / 256),
      uncompressedSize: readU32(archive, cursor + 24),
    });
    cursor = nameEnd + extraLength + commentLength;
  }

  if (entries.length !== totalEntries) {
    throw new PluginPackageError("invalid_archive");
  }
  return entries;
}

function findEocdOffset(archive: Uint8Array): number {
  const minimum = 22;
  if (archive.byteLength < minimum) {
    throw new PluginPackageError("invalid_archive");
  }
  const maxComment = Math.min(0xff_ff, archive.byteLength - minimum);
  for (let comment = 0; comment <= maxComment; comment += 1) {
    const offset = archive.byteLength - minimum - comment;
    if (readU32(archive, offset) !== EOCD_SIGNATURE) {
      continue;
    }
    if (readU16(archive, offset + 20) === comment) {
      return offset;
    }
  }
  throw new PluginPackageError("invalid_archive");
}

function classifyZipEntry(
  entry: CentralDirectoryEntry
): "directory" | "file" | "other" {
  if (entry.name.endsWith("/")) {
    return "directory";
  }
  if (entry.os === UNIX_OS) {
    const mode = Math.floor(entry.attrs / 65_536);
    if (mode >= UNIX_IFDIR_MIN && mode <= UNIX_IFDIR_MAX) {
      return "directory";
    }
    if (mode !== 0 && (mode < UNIX_IFREG_MIN || mode > UNIX_IFREG_MAX)) {
      return "other";
    }
  }
  if (Math.floor(entry.attrs / 16) % 2 === 1) {
    return "directory";
  }
  return "file";
}

function normalizeArchivePath(name: string): string {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("%") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new PluginPackageError("unsafe_path");
  }
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = trimmed.split("/");
  if (
    parts.length === 0 ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new PluginPackageError("unsafe_path");
  }
  return parts.join("/");
}

function resolvePackageRoot(names: string[]): string {
  const manifests = names.filter(
    (name) =>
      name === PLUGIN_MANIFEST_FILENAME ||
      name.endsWith(`/${PLUGIN_MANIFEST_FILENAME}`)
  );
  if (manifests.length !== 1) {
    throw new PluginPackageError("missing_manifest");
  }
  const manifestName = manifests[0] ?? PLUGIN_MANIFEST_FILENAME;
  if (manifestName === PLUGIN_MANIFEST_FILENAME) {
    return "";
  }
  return manifestName.slice(0, -(PLUGIN_MANIFEST_FILENAME.length + 1));
}

function toPackageRelativePath(
  name: string,
  packageRoot: string
): string | null {
  const normalized = normalizeArchivePath(name);
  if (!packageRoot) {
    return normalized;
  }
  if (normalized === packageRoot) {
    return null;
  }
  const prefix = `${packageRoot}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  return normalized.slice(prefix.length);
}

function assertReferencedFilesExist(
  manifest: PluginManifest,
  files: Map<string, Uint8Array>
): void {
  for (const skill of manifest.skills) {
    if (!hasPrefix(files, skill.directory)) {
      throw new PluginPackageError("missing_referenced_file");
    }
  }
  for (const action of manifest.actions) {
    if (!files.has(action.entry)) {
      throw new PluginPackageError("missing_referenced_file");
    }
  }
  if (
    manifest.ui &&
    !(
      files.has(manifest.ui.entryHtml) &&
      hasPrefix(files, manifest.ui.assetsDir)
    )
  ) {
    throw new PluginPackageError("missing_referenced_file");
  }
  for (const migration of manifest.database?.migrations ?? []) {
    if (!files.has(migration.path)) {
      throw new PluginPackageError("missing_referenced_file");
    }
  }
  for (const hook of [manifest.hooks?.activate, manifest.hooks?.deactivate]) {
    if (hook && !files.has(hook)) {
      throw new PluginPackageError("missing_referenced_file");
    }
  }
}

function hasPrefix(files: Map<string, Uint8Array>, directory: string): boolean {
  const prefix = `${directory}/`;
  for (const name of files.keys()) {
    if (name === directory || name.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

async function writePackageTree(
  stagingDir: string,
  files: Map<string, Uint8Array>
): Promise<void> {
  const root = resolve(stagingDir);
  await ensureDir(root);
  for (const [relativePath, data] of files) {
    const dest = resolve(root, relativePath);
    if (dest !== root && !dest.startsWith(`${root}${sep}`)) {
      throw new PluginPackageError("unsafe_path");
    }
    await ensureDir(dirname(dest));
    await writeFile(dest, data, { mode: 0o600 });
  }
}

async function cleanupAbandonedStaging(configDir: string): Promise<void> {
  await rm(getPluginStagingRootDir(configDir), {
    force: true,
    recursive: true,
  });
}

function digestArchive(archive: Uint8Array): string {
  return createHash("sha256").update(archive).digest("hex");
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function readU16(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 2).getUint16(
    0,
    true
  );
}

function readU32(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(
    0,
    true
  );
}

async function withInstallLock<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = installLocks.get(key) ?? Promise.resolve();
  let releaseLock = () => {};
  const current = new Promise<void>((resolveLock) => {
    releaseLock = resolveLock;
  });
  const chained = previous.then(() => current);
  installLocks.set(key, chained);
  await previous;
  try {
    return await work();
  } finally {
    releaseLock();
    if (installLocks.get(key) === chained) {
      installLocks.delete(key);
    }
  }
}
