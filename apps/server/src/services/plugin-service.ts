import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertConfigPathSegment,
  buildToolExecutionContext,
  ensureDir,
  getOrgPluginDatabasePath,
  getOrgPluginDataDir,
  getPluginReleaseDir,
  getPluginStagingRootDir,
  PLUGIN_MANIFEST_API_VERSION,
  PLUGIN_MANIFEST_FILENAME,
  type PluginActionAccess,
  type PluginActorRole,
  type PluginExecutionActor,
  type PluginExecutionContext,
  type PluginManifest,
  pathExists,
  resolvePluginReleaseEntry,
  validatePluginJsonInstance,
  validatePluginManifest,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { spawnJsonTool } from "./custom-tool-subprocess";

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
const BUN_BIN = process.env.NAKAMA_BUN_BIN ?? "bun";
const PLUGIN_RUNNER_PATH = fileURLToPath(
  new URL("./plugin-runner.js", import.meta.url)
);
const MAX_PLUGIN_INVOCATIONS = 4;
const SPOOFABLE_INPUT_KEYS = new Set([
  "actor",
  "actorId",
  "apiVersion",
  "context",
  "databasePath",
  "dataDir",
  "dataDirectory",
  "invocationId",
  "orgId",
  "organizationId",
  "orgRole",
  "pluginId",
  "pluginVersion",
  "profileId",
  "role",
  "sessionId",
  "workspaceRoot",
]);

export type PluginInvocationErrorCode =
  | "admission_closed"
  | "busy"
  | "forbidden"
  | "invalid_entry"
  | "invalid_input"
  | "not_enabled"
  | "not_installed"
  | "unknown_action"
  | "unknown_hook";

export class PluginInvocationError extends Error {
  readonly code: PluginInvocationErrorCode;
  readonly retryable: boolean;

  constructor(code: PluginInvocationErrorCode, retryable = code === "busy") {
    super(code);
    this.name = "PluginInvocationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type PluginActionAccessKind = "tool" | "ui";
export type PluginHookKind = "activate" | "deactivate";

export interface InvokePluginActionInput {
  access: PluginActionAccessKind;
  actionKey: string;
  actor: PluginExecutionActor;
  input: unknown;
  orgId: string;
  pluginId: string;
  profileId?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface InvokePluginHookInput {
  actor: PluginExecutionActor;
  kind: PluginHookKind;
  orgId: string;
  pluginId: string;
  signal?: AbortSignal;
}

export interface PluginInvocationResult {
  invocationId: string;
  result: unknown;
}

interface AdmissionGate {
  active: number;
  closed: boolean;
  tail: Promise<unknown>;
}

const admissionGates = new Map<string, AdmissionGate>();

export function resetPluginAdmissionForTests(): void {
  admissionGates.clear();
}

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

  async invokePluginAction(
    input: InvokePluginActionInput
  ): Promise<PluginInvocationResult> {
    const { handle, install, manifest, releaseDir } =
      await this.admitInvocation(input.orgId, input.pluginId, "action");
    try {
      const action = manifest.actions.find(
        (item) => item.key === input.actionKey
      );
      if (!action) {
        throw new PluginInvocationError("unknown_action");
      }
      if (!actorMayInvoke(action.access, input.actor.role)) {
        throw new PluginInvocationError("forbidden");
      }

      const cleanedInput = stripSpoofedInput(input.input);
      if (!validatePluginJsonInstance(action.inputSchema, cleanedInput).ok) {
        throw new PluginInvocationError("invalid_input");
      }

      const context = this.buildInvocationContext({
        actor: input.actor,
        install,
        invocationId: handle.invocationId,
        manifest,
        orgId: input.orgId,
        pluginId: input.pluginId,
        profileId: input.access === "tool" ? input.profileId : undefined,
        sessionId: input.access === "tool" ? input.sessionId : undefined,
      });
      if (input.access === "tool" && !context.profileId) {
        throw new PluginInvocationError("invalid_input");
      }

      return {
        invocationId: handle.invocationId,
        result: await this.spawnPluginModule({
          context,
          entry: action.entry,
          input: cleanedInput,
          label: "Plugin action",
          releaseDir,
          signal: input.signal,
        }),
      };
    } finally {
      handle.release();
    }
  }

  async invokePluginHook(
    input: InvokePluginHookInput
  ): Promise<PluginInvocationResult> {
    const { handle, install, manifest, releaseDir } =
      await this.admitInvocation(input.orgId, input.pluginId, "hook");
    try {
      const entry =
        input.kind === "activate"
          ? manifest.hooks?.activate
          : manifest.hooks?.deactivate;
      if (!entry) {
        throw new PluginInvocationError("unknown_hook");
      }

      const context = this.buildInvocationContext({
        actor: input.actor,
        install,
        invocationId: handle.invocationId,
        manifest,
        orgId: input.orgId,
        pluginId: input.pluginId,
      });

      return {
        invocationId: handle.invocationId,
        result: await this.spawnPluginModule({
          context,
          entry,
          input: {},
          label: "Plugin hook",
          releaseDir,
          signal: input.signal,
        }),
      };
    } finally {
      handle.release();
    }
  }

  async closePluginAdmission(orgId: string, pluginId: string): Promise<void> {
    const gate = admissionGateFor(orgId, pluginId);
    await withAdmissionGate(gate, () => {
      gate.closed = true;
    });
  }

  private async admitInvocation(
    orgId: string,
    pluginId: string,
    kind: "action" | "hook"
  ): Promise<{
    handle: { invocationId: string; release: () => void };
    install: NonNullable<Awaited<ReturnType<DatabaseAdapter["getOrgPlugin"]>>>;
    manifest: PluginManifest;
    releaseDir: string;
  }> {
    const gate = admissionGateFor(orgId, pluginId);
    return withAdmissionGate(gate, async () => {
      if (kind === "action" && gate.closed) {
        throw new PluginInvocationError("admission_closed");
      }

      const install = await this.db.getOrgPlugin(orgId, pluginId);
      if (!(install && install.selectedVersion)) {
        throw new PluginInvocationError("not_installed");
      }
      if (kind === "action" && install.lifecycleState !== "enabled") {
        throw new PluginInvocationError("not_enabled");
      }
      if (gate.active >= MAX_PLUGIN_INVOCATIONS) {
        throw new PluginInvocationError("busy", true);
      }

      const release = await this.db.getPluginRelease(
        pluginId,
        install.selectedVersion
      );
      if (!release) {
        throw new PluginInvocationError("not_installed");
      }

      const releaseDir = getPluginReleaseDir(
        pluginId,
        install.selectedVersion,
        this.configDir
      );
      if (!(await pathExists(releaseDir))) {
        throw new PluginInvocationError("not_installed");
      }

      gate.active += 1;
      return {
        handle: {
          invocationId: randomUUID(),
          release: () => {
            gate.active = Math.max(0, gate.active - 1);
          },
        },
        install,
        manifest: release.manifest,
        releaseDir,
      };
    });
  }

  private buildInvocationContext(input: {
    actor: PluginExecutionActor;
    install: NonNullable<Awaited<ReturnType<DatabaseAdapter["getOrgPlugin"]>>>;
    invocationId: string;
    manifest: PluginManifest;
    orgId: string;
    pluginId: string;
    profileId?: string;
    sessionId?: string;
  }): PluginExecutionContext {
    const dataDir = getOrgPluginDataDir(
      input.orgId,
      input.pluginId,
      this.configDir
    );
    const context: PluginExecutionContext = {
      actor: { id: input.actor.id, role: input.actor.role },
      apiVersion: PLUGIN_MANIFEST_API_VERSION,
      dataDir,
      invocationId: input.invocationId,
      orgId: input.orgId,
      pluginId: input.pluginId,
      pluginVersion: input.manifest.version,
    };

    if (input.install.databaseGeneration) {
      context.databasePath = getOrgPluginDatabasePath(
        input.orgId,
        input.pluginId,
        input.install.databaseGeneration,
        this.configDir
      );
    }

    if (input.profileId) {
      const toolContext = buildToolExecutionContext({
        orgId: input.orgId,
        profileId: input.profileId,
        sessionId: input.sessionId,
        workspaceRoot: join(
          this.configDir,
          "orgs",
          assertConfigPathSegment(input.orgId, "orgId"),
          "profiles",
          assertConfigPathSegment(input.profileId, "profileId")
        ),
      });
      context.profileId = input.profileId;
      if (input.sessionId) {
        context.sessionId = input.sessionId;
      }
      if (toolContext.workspaceRoot) {
        context.workspaceRoot = toolContext.workspaceRoot;
      }
    }

    return context;
  }

  private async spawnPluginModule(input: {
    context: PluginExecutionContext;
    entry: string;
    input: unknown;
    label: string;
    releaseDir: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    let entryPath: string;
    try {
      entryPath = resolvePluginReleaseEntry(input.releaseDir, input.entry);
    } catch {
      throw new PluginInvocationError("invalid_entry");
    }
    if (!(await pathExists(entryPath))) {
      throw new PluginInvocationError("invalid_entry");
    }

    await ensureDir(input.context.dataDir);

    return spawnJsonTool({
      args: [PLUGIN_RUNNER_PATH, entryPath],
      bin: BUN_BIN,
      context: { signal: input.signal },
      cwd: input.releaseDir,
      input: input.input,
      label: input.label,
      transport: {
        extraArgs: ["--no-install"],
        includeConfigDir: false,
        stdin: {
          context: input.context,
          input: input.input,
        },
      },
      workspaceRoot: input.context.workspaceRoot,
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

function admissionGateFor(orgId: string, pluginId: string): AdmissionGate {
  const key = `${orgId}\0${pluginId}`;
  const existing = admissionGates.get(key);
  if (existing) {
    return existing;
  }
  const created: AdmissionGate = {
    active: 0,
    closed: false,
    tail: Promise.resolve(),
  };
  admissionGates.set(key, created);
  return created;
}

async function withAdmissionGate<T>(
  gate: AdmissionGate,
  work: () => Promise<T> | T
): Promise<T> {
  let releaseLock = () => {};
  const current = new Promise<void>((resolveLock) => {
    releaseLock = resolveLock;
  });
  const previous = gate.tail;
  gate.tail = previous.then(() => current);
  await previous;
  try {
    return await work();
  } finally {
    releaseLock();
  }
}

function actorMayInvoke(
  access: PluginActionAccess,
  role: PluginActorRole
): boolean {
  if (role === "viewer") {
    return false;
  }
  if (access === "admin") {
    return role === "admin";
  }
  return role === "admin" || role === "member";
}

function stripSpoofedInput(input: unknown): unknown {
  if (!isPlainObject(input)) {
    return input;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SPOOFABLE_INPUT_KEYS.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
