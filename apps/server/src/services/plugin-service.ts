import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  assertConfigPathSegment,
  buildToolExecutionContext,
  derivePluginToolName,
  ensureDir,
  getOrgPluginDatabasePath,
  getOrgPluginDataDir,
  getPluginReleaseDir,
  getPluginStagingRootDir,
  getPluginsRootDir,
  type OrgPluginDetail,
  PLUGIN_MANIFEST_API_VERSION,
  PLUGIN_MANIFEST_FILENAME,
  type PluginActionAccess,
  type PluginActionDescription,
  type PluginActorRole,
  type PluginExecutionActor,
  type PluginExecutionContext,
  type PluginManifest,
  type PluginReleaseSummary,
  type PluginUiContribution,
  pathExists,
  resolvePluginReleaseEntry,
  validatePluginJsonInstance,
  validatePluginManifest,
} from "@nakama/core";
import type { PluginPackageRequest } from "@nakama/core/contract";
import type {
  DatabaseAdapter,
  StoredOrgPluginRecord,
  StoredSkillRecord,
  StoredToolRecord,
} from "@nakama/db";
import * as pacote from "pacote";
import { Parser } from "tar";
import { spawnJsonTool } from "./custom-tool-subprocess";

const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_PATH_BYTES = 240;

export class PluginHostError extends Error {
  constructor(
    readonly code: string,
    message = code
  ) {
    super(message);
  }
}

export interface PluginPackagePreview {
  contributions: PluginContributionSummary;
  digest: string;
  integrity: string;
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
  expectedIntegrity?: string;
}

interface PluginContributionSummary {
  actionKeys: string[];
  hasDatabase: boolean;
  hasUi: boolean;
  skillKeys: string[];
}

interface InspectedPackage {
  digest: string;
  files: Map<string, Uint8Array>;
  integrity: string;
  manifest: PluginManifest;
}

const installLocks = new Map<string, Promise<unknown>>();
const officialInstallLocks = new Map<string, Promise<unknown>>();
// Shipped composition, rather than package author/id claims, grants official status.
const OFFICIAL_PLUGINS = new Map<
  string,
  { requiresHost: boolean; setupAction?: string }
>([["workflows", { requiresHost: true, setupAction: "import_legacy" }]]);
const lifecycleLocks = new Map<string, Promise<unknown>>();
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

export interface PluginServiceOptions {
  drainTimeoutMs?: number;
  officialPackagesDir?: string;
  onHostRequest?: (
    request: unknown,
    context: PluginExecutionContext,
    signal?: AbortSignal
  ) => Promise<unknown>;
}

let pluginLifecycleTestHooks: {
  afterMigrationBeforePublish?: () => Promise<void>;
  afterPublishBeforeFinalize?: () => Promise<void>;
} = {};

export function setPluginLifecycleTestHooks(
  hooks: typeof pluginLifecycleTestHooks | null
): void {
  pluginLifecycleTestHooks = hooks ?? {};
}

interface PendingPluginOperation {
  kind: "disable" | "enable" | "uninstall" | "update";
  operationId: string;
  targetGeneration: string | null;
  targetVersion: string | null;
}

type PluginActionAccessKind = "tool" | "ui";

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

export interface PluginInvocationResult {
  invocationId: string;
  result: unknown;
}

interface AdmissionGate {
  active: number;
  closed: boolean;
  controllers: Set<AbortController>;
  tail: Promise<unknown>;
}

const admissionGates = new Map<string, AdmissionGate>();
// One API process owns plugin execution. Exports also exclude package/lifecycle
// mutations, which may change the selected database while it is being copied.
let exportPending = false;
let activeMutations = 0;
const MIGRATION_LEDGER_TABLE = "_nakama_plugin_migrations";
const DEFAULT_DRAIN_TIMEOUT_MS = 6000;

export function resetPluginAdmissionForTests(): void {
  admissionGates.clear();
  pluginLifecycleTestHooks = {};
  exportPending = false;
  activeMutations = 0;
}

export class PluginExportBarrierError extends Error {
  constructor(
    message = "Plugin export timed out waiting for in-flight calls."
  ) {
    super(message);
    this.name = "PluginExportBarrierError";
  }
}

function pluginReleaseIntegrityPath(
  pluginId: string,
  version: string,
  configDir: string
): string {
  return `${getPluginReleaseDir(pluginId, version, configDir)}.integrity`;
}

export async function runWithPluginExportBarrier<T>(
  work: () => Promise<T>,
  options: { drainTimeoutMs?: number } = {}
): Promise<T> {
  if (exportPending) {
    throw new PluginExportBarrierError(
      "A plugin export is already in progress."
    );
  }
  exportPending = true;
  const timeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  try {
    const deadline = Date.now() + timeoutMs;
    while (activeMutations > 0 && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    if (activeMutations > 0) {
      throw new PluginExportBarrierError();
    }
    const gates = [...admissionGates.values()];
    await Promise.all(gates.map((gate) => drainAdmissionGate(gate, timeoutMs)));
    if (gates.some((gate) => gate.active > 0)) {
      throw new PluginExportBarrierError();
    }
    return await work();
  } finally {
    exportPending = false;
  }
}

async function withPluginMutation<T>(work: () => Promise<T>): Promise<T> {
  if (exportPending) {
    throw new PluginHostError("in_use");
  }
  activeMutations += 1;
  try {
    return await work();
  } finally {
    activeMutations -= 1;
  }
}

export async function vacuumPluginDatabaseInto(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await ensureDir(dirname(targetPath));
  const source = new Database(sourcePath);
  try {
    source.exec(`VACUUM INTO ${sqlQuote(targetPath)}`);
  } finally {
    source.close();
  }
}

export async function shutdownPluginRuntime(timeoutMs = 1500): Promise<void> {
  const gates = [...admissionGates.values()];
  for (const gate of gates) {
    gate.closed = true;
    for (const controller of gate.controllers) {
      controller.abort();
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gates.every((gate) => gate.active === 0)) {
      return;
    }
    await Bun.sleep(25);
  }
}

export class PluginService {
  private readonly configDir: string;
  private readonly options: PluginServiceOptions;

  constructor(
    private readonly db: DatabaseAdapter,
    configDir: string,
    options: PluginServiceOptions = {}
  ) {
    if (!isAbsolute(configDir)) {
      throw new Error(
        "configDir must be an absolute path; relative paths resolve against process.cwd() and break plugin isolation."
      );
    }
    this.configDir = configDir;
    this.options = options;
  }

  async previewPluginPackage(
    source: PluginPackageRequest
  ): Promise<PluginPackagePreview> {
    const inspected = await inspectPluginPackage(source);
    return toPreview(inspected);
  }

  async listOfficialPlugins() {
    if (!this.options.officialPackagesDir) {
      return [];
    }
    return Promise.all(
      [...OFFICIAL_PLUGINS.keys()].map(async (pluginId) => {
        const inspected = await this.inspectOfficialPlugin(pluginId);
        const { id, name, description, version } = inspected.manifest;
        return { description, id, name, version };
      })
    );
  }

  async installOfficialPlugin(
    orgId: string,
    pluginId: string,
    actor: PluginExecutionActor
  ) {
    if (actor.role !== "admin") {
      throw new PluginHostError("forbidden");
    }
    const official = OFFICIAL_PLUGINS.get(pluginId);
    if (!official) {
      throw new PluginHostError("not_found");
    }
    if (official.requiresHost && !this.options.onHostRequest) {
      throw new PluginHostError(
        "package_unavailable",
        "This plugin requires agent host capabilities."
      );
    }
    const inspected = await this.inspectOfficialPlugin(pluginId);
    return withKeyedLock(
      officialInstallLocks,
      `${this.configDir}:${orgId}:${pluginId}`,
      async () => {
        await withPluginMutation(() =>
          withKeyedLock(
            installLocks,
            `${pluginId}@${inspected.manifest.version}`,
            () =>
              withKeyedLock(stagingLocks, "staging", () =>
                this.publishInspectedPackage(inspected)
              )
          )
        );
        let install = await this.db.getOrgPlugin(orgId, pluginId);
        if (!install || install.lifecycleState === "retained") {
          install = await this.addOrgPlugin(
            orgId,
            pluginId,
            inspected.manifest.version
          );
        }
        const enabledByInstall = install.lifecycleState === "disabled";
        if (enabledByInstall) {
          install = await this.enableOrgPlugin(
            orgId,
            pluginId,
            install.revision
          );
        }
        if (install.lifecycleState !== "enabled") {
          throw new PluginHostError("invalid_state");
        }
        if (official.setupAction) {
          try {
            await this.invokePluginAction({
              access: "ui",
              actionKey: official.setupAction,
              actor,
              input: {},
              orgId,
              pluginId,
            });
          } catch (error) {
            if (enabledByInstall) {
              await this.disableOrgPlugin(orgId, pluginId, install.revision);
            }
            throw error;
          }
        }
        return install;
      }
    );
  }

  private async inspectOfficialPlugin(
    pluginId: string
  ): Promise<InspectedPackage> {
    // This allowlist is shipped with Nakama; package metadata cannot grant official status.
    if (!(OFFICIAL_PLUGINS.has(pluginId) && this.options.officialPackagesDir)) {
      throw new PluginHostError("not_found");
    }
    const directory = join(this.options.officialPackagesDir, pluginId);
    const files = new Map<string, Uint8Array>();
    for (const file of ["package.json", PLUGIN_MANIFEST_FILENAME]) {
      files.set(file, await readFile(join(directory, file)));
    }
    for (const folder of ["actions", "migrations", "ui", "skills"]) {
      for (const entry of await readdir(join(directory, folder), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) {
          continue;
        }
        const path = join(entry.parentPath, entry.name);
        files.set(
          relative(directory, path).split(sep).join("/"),
          await readFile(path)
        );
      }
    }
    const validated = validatePluginManifest(
      JSON.parse(Buffer.from(files.get(PLUGIN_MANIFEST_FILENAME)!).toString())
    );
    if (!validated.ok || validated.manifest.id !== pluginId) {
      throw new PluginHostError("invalid_manifest");
    }
    assertReferencedFilesExist(validated.manifest, files);
    const hash = createHash("sha256");
    for (const [name, data] of [...files].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      hash.update(JSON.stringify([name, data.byteLength])).update(data);
    }
    return {
      digest: hash.digest("hex"),
      files,
      integrity: "bundled",
      manifest: validated.manifest,
    };
  }

  async installPluginPackage(
    source: PluginPackageRequest,
    options: InstallPluginPackageOptions = {}
  ): Promise<PluginPackageInstallResult> {
    return withPluginMutation(async () => {
      const inspected = await inspectPluginPackage(
        source,
        options.expectedIntegrity
      );
      if (
        options.expectedDigest !== undefined &&
        options.expectedDigest !== inspected.digest
      ) {
        throw new PluginHostError("digest_mismatch");
      }

      const { id, version } = inspected.manifest;
      return withKeyedLock(installLocks, `${id}@${version}`, async () =>
        withKeyedLock(stagingLocks, "staging", async () => {
          await cleanupAbandonedStaging(this.configDir);
          try {
            return await this.publishInspectedPackage(inspected);
          } finally {
            await cleanupAbandonedStaging(this.configDir);
          }
        })
      );
    });
  }

  async invokePluginAction(
    input: InvokePluginActionInput
  ): Promise<PluginInvocationResult> {
    if (input.access === "tool") {
      await this.assertToolAssignment(input);
    }

    const { handle, install, manifest, releaseDir } =
      await this.admitInvocation(input.orgId, input.pluginId);
    try {
      const action = manifest.actions.find(
        (item) => item.key === input.actionKey
      );
      if (!action) {
        throw new PluginHostError("unknown_action");
      }
      if (!actorMayInvoke(action.access, input.actor.role)) {
        throw new PluginHostError("forbidden");
      }

      const cleanedInput = stripSpoofedInput(input.input);
      if (!validatePluginJsonInstance(action.inputSchema, cleanedInput).ok) {
        throw new PluginHostError("invalid_input");
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
      context.actionKey = action.key;
      if (input.access === "tool" && !context.profileId) {
        throw new PluginHostError("invalid_input");
      }

      return {
        invocationId: handle.invocationId,
        result: await this.spawnPluginModule({
          context,
          entry: action.entry,
          input: cleanedInput,
          label: "Plugin action",
          releaseDir,
          signal: mergeAbortSignals(input.signal, handle.abort.signal),
        }),
      };
    } finally {
      handle.release();
    }
  }

  async capabilityRevisionForOrg(orgId: string): Promise<string> {
    const installs = await this.db.listOrgPlugins(orgId);
    return installs
      .map(
        (install) =>
          `${install.pluginId}:${install.revision}:${install.lifecycleState}:${install.selectedVersion ?? ""}`
      )
      .sort()
      .join(";");
  }

  async resolveEnabledSkillDirectory(
    orgId: string,
    pluginId: string,
    pluginKey: string
  ): Promise<string | null> {
    const install = await this.db.getOrgPlugin(orgId, pluginId);
    if (
      !(
        install &&
        install.lifecycleState === "enabled" &&
        install.selectedVersion
      )
    ) {
      return null;
    }

    const release = await this.db.getPluginRelease(
      pluginId,
      install.selectedVersion
    );
    const skill = release?.manifest.skills.find(
      (item) => item.key === pluginKey
    );
    if (!skill) {
      return null;
    }

    const releaseDir = getPluginReleaseDir(
      pluginId,
      install.selectedVersion,
      this.configDir
    );
    try {
      return resolvePluginReleaseEntry(releaseDir, skill.directory);
    } catch {
      return null;
    }
  }

  async getEnabledExposedAction(
    orgId: string,
    pluginId: string,
    actionKey: string
  ): Promise<PluginManifest["actions"][number] | null> {
    const install = await this.db.getOrgPlugin(orgId, pluginId);
    if (
      !(
        install &&
        install.lifecycleState === "enabled" &&
        install.selectedVersion
      )
    ) {
      return null;
    }
    const release = await this.db.getPluginRelease(
      pluginId,
      install.selectedVersion
    );
    const action = release?.manifest.actions.find(
      (item) => item.key === actionKey && item.exposeAsTool
    );
    return action ?? null;
  }

  async previewPluginContributionChanges(
    orgId: string,
    pluginId: string,
    targetVersion: string
  ): Promise<{
    removedActionKeys: string[];
    removedSkillKeys: string[];
    retainedSkillIds: string[];
    retainedToolIds: string[];
  }> {
    const target = await this.db.getPluginRelease(pluginId, targetVersion);
    if (!target) {
      throw new PluginHostError("not_found");
    }

    const targetSkillKeys = new Set(
      target.manifest.skills.map((skill) => skill.key)
    );
    const targetActionKeys = new Set(
      target.manifest.actions
        .filter((action) => action.exposeAsTool)
        .map((action) => action.key)
    );
    const skills = (await this.db.listSkills()).filter(
      (skill) => skill.orgId === orgId && skill.pluginId === pluginId
    );
    const tools = (await this.db.listTools()).filter(
      (tool) => tool.orgId === orgId && tool.pluginId === pluginId
    );

    return {
      removedActionKeys: tools
        .filter((tool) => !targetActionKeys.has(tool.pluginKey ?? ""))
        .map((tool) => tool.pluginKey ?? "")
        .filter(Boolean)
        .sort(),
      removedSkillKeys: skills
        .filter((skill) => !targetSkillKeys.has(skill.pluginKey ?? ""))
        .map((skill) => skill.pluginKey ?? "")
        .filter(Boolean)
        .sort(),
      retainedSkillIds: skills
        .filter((skill) => targetSkillKeys.has(skill.pluginKey ?? ""))
        .map((skill) => skill.id)
        .sort(),
      retainedToolIds: tools
        .filter((tool) => targetActionKeys.has(tool.pluginKey ?? ""))
        .map((tool) => tool.id)
        .sort(),
    };
  }

  async closePluginAdmission(orgId: string, pluginId: string): Promise<void> {
    const gate = admissionGateFor(orgId, pluginId);
    await withAdmissionGate(gate, () => {
      gate.closed = true;
    });
    for (const controller of [...gate.controllers]) {
      controller.abort();
    }
    await drainAdmissionGate(
      gate,
      this.options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
    );
    if (gate.active > 0) {
      throw new PluginHostError("in_use");
    }
  }

  async addOrgPlugin(
    orgId: string,
    pluginId: string,
    version?: string
  ): Promise<StoredOrgPluginRecord> {
    return this.withOrgPluginMutation(orgId, pluginId, async () => {
      const existing = await this.db.getOrgPlugin(orgId, pluginId);
      const release = await this.resolveApprovedRelease(pluginId, version);
      if (!release) {
        throw new PluginHostError("not_found");
      }

      if (!existing) {
        return this.writeOrgPluginState({
          databaseGeneration: null,
          expectedRevision: 0,
          lifecycleState: "disabled",
          orgId,
          pluginId,
          selectedVersion: release.version,
        });
      }

      if (existing.lifecycleState === "retained") {
        await this.assertReinstallCompatible(
          orgId,
          pluginId,
          existing,
          release.manifest
        );
        return this.writeOrgPluginState({
          databaseGeneration: existing.databaseGeneration,
          expectedRevision: existing.revision,
          lastLifecycleError: null,
          lifecycleState: "disabled",
          orgId,
          pluginId,
          selectedVersion: release.version,
        });
      }

      if (existing.lifecycleState === "disabled") {
        if (version && existing.selectedVersion !== version) {
          throw new PluginHostError("invalid_state");
        }
        return existing;
      }

      throw new PluginHostError("invalid_state");
    });
  }

  async enableOrgPlugin(
    orgId: string,
    pluginId: string,
    expectedRevision: number
  ): Promise<StoredOrgPluginRecord> {
    return this.withOrgPluginMutation(orgId, pluginId, async () => {
      const install = await this.requireOrgPlugin(orgId, pluginId);
      if (install.revision !== expectedRevision) {
        throw new PluginHostError("stale_revision");
      }
      if (install.lifecycleState !== "disabled" || !install.selectedVersion) {
        throw new PluginHostError("invalid_state");
      }

      const release = await this.db.getPluginRelease(
        pluginId,
        install.selectedVersion
      );
      if (!release) {
        throw new PluginHostError("package_unavailable");
      }
      if (await this.describeMissingPluginBytes(install)) {
        throw new PluginHostError("package_unavailable");
      }

      const operationId = randomUUID();
      const targetGeneration = await this.planDatabaseGeneration(
        orgId,
        pluginId,
        install,
        release.manifest
      );
      const pending = serializePending({
        kind: "enable",
        operationId,
        targetGeneration,
        targetVersion: install.selectedVersion,
      });
      const enabling = await this.writeOrgPluginState({
        databaseGeneration: install.databaseGeneration,
        expectedRevision,
        lastLifecycleError: null,
        lifecycleState: "enabling",
        orgId,
        pendingOperation: pending,
        pluginId,
        selectedVersion: install.selectedVersion,
      });

      let published = false;
      try {
        await this.preparePluginDatabase({
          install,
          manifest: release.manifest,
          orgId,
          pluginId,
          targetGeneration,
          version: install.selectedVersion,
        });
        await pluginLifecycleTestHooks.afterMigrationBeforePublish?.();
        await this.publishInstallation({
          databaseGeneration: targetGeneration,
          expectedRevision: enabling.revision,
          lastLifecycleError: null,
          lifecycleState: "enabling",
          manifest: release.manifest,
          orgId,
          pendingOperation: pending,
          pluginId,
          selectedVersion: install.selectedVersion,
        });
        published = true;
        await pluginLifecycleTestHooks.afterPublishBeforeFinalize?.();
        const enabled = await this.writeOrgPluginState({
          databaseGeneration: targetGeneration,
          expectedRevision: enabling.revision + 1,
          lastLifecycleError: null,
          lifecycleState: "enabled",
          orgId,
          pendingOperation: null,
          pluginId,
          selectedVersion: install.selectedVersion,
        });
        this.openPluginAdmission(orgId, pluginId);
        return enabled;
      } catch (error) {
        if (error instanceof PluginHostError && error.code === "interrupted") {
          throw error;
        }
        if (!published) {
          await this.discardUnpublishedGeneration(
            orgId,
            pluginId,
            install.databaseGeneration,
            targetGeneration
          );
          await this.writeOrgPluginState({
            databaseGeneration: install.databaseGeneration,
            expectedRevision: enabling.revision,
            lastLifecycleError: lifecycleErrorMessage(error),
            lifecycleState: "disabled",
            orgId,
            pendingOperation: null,
            pluginId,
            selectedVersion: install.selectedVersion,
          }).catch(() => undefined);
        }
        if (error instanceof PluginHostError) {
          throw error;
        }
        throw new PluginHostError(
          "migration_failed",
          lifecycleErrorMessage(error)
        );
      }
    });
  }

  async disableOrgPlugin(
    orgId: string,
    pluginId: string,
    expectedRevision: number
  ): Promise<StoredOrgPluginRecord> {
    return this.withOrgPluginMutation(orgId, pluginId, async () => {
      const install = await this.requireOrgPlugin(orgId, pluginId);
      if (install.revision !== expectedRevision) {
        throw new PluginHostError("stale_revision");
      }
      if (install.lifecycleState !== "enabled") {
        throw new PluginHostError("invalid_state");
      }

      const pending = serializePending({
        kind: "disable",
        operationId: randomUUID(),
        targetGeneration: install.databaseGeneration,
        targetVersion: install.selectedVersion,
      });
      const disabling = await this.writeOrgPluginState({
        databaseGeneration: install.databaseGeneration,
        expectedRevision,
        lastLifecycleError: null,
        lifecycleState: "disabling",
        orgId,
        pendingOperation: pending,
        pluginId,
        selectedVersion: install.selectedVersion,
      });

      await this.closePluginAdmission(orgId, pluginId);

      return this.writeOrgPluginState({
        databaseGeneration: install.databaseGeneration,
        expectedRevision: disabling.revision,
        lastLifecycleError: null,
        lifecycleState: "disabled",
        orgId,
        pendingOperation: null,
        pluginId,
        selectedVersion: install.selectedVersion,
      });
    });
  }

  async updateOrgPlugin(
    orgId: string,
    pluginId: string,
    targetVersion: string,
    expectedRevision: number
  ): Promise<StoredOrgPluginRecord> {
    return this.withOrgPluginMutation(orgId, pluginId, async () => {
      const install = await this.requireOrgPlugin(orgId, pluginId);
      if (install.revision !== expectedRevision) {
        throw new PluginHostError("stale_revision");
      }
      if (install.lifecycleState !== "disabled" || !install.selectedVersion) {
        throw new PluginHostError("invalid_state");
      }

      const target = await this.db.getPluginRelease(pluginId, targetVersion);
      if (!target) {
        throw new PluginHostError("not_found");
      }
      this.assertContributionNames(pluginId, target.manifest);

      const targetGeneration = await this.planDatabaseGeneration(
        orgId,
        pluginId,
        install,
        target.manifest
      );
      const pending = serializePending({
        kind: "update",
        operationId: randomUUID(),
        targetGeneration,
        targetVersion,
      });
      const updating = await this.writeOrgPluginState({
        databaseGeneration: install.databaseGeneration,
        expectedRevision,
        lastLifecycleError: null,
        lifecycleState: "updating",
        orgId,
        pendingOperation: pending,
        pluginId,
        selectedVersion: install.selectedVersion,
      });

      let published = false;
      try {
        await this.closePluginAdmission(orgId, pluginId);
        await this.preparePluginDatabase({
          install,
          manifest: target.manifest,
          orgId,
          pluginId,
          targetGeneration,
          version: targetVersion,
        });
        await pluginLifecycleTestHooks.afterMigrationBeforePublish?.();
        await this.publishInstallation({
          databaseGeneration: targetGeneration,
          expectedRevision: updating.revision,
          lastLifecycleError: null,
          lifecycleState: "updating",
          manifest: target.manifest,
          orgId,
          pendingOperation: pending,
          pluginId,
          selectedVersion: targetVersion,
        });
        published = true;
        await pluginLifecycleTestHooks.afterPublishBeforeFinalize?.();
        return this.writeOrgPluginState({
          databaseGeneration: targetGeneration,
          expectedRevision: updating.revision + 1,
          lastLifecycleError: null,
          lifecycleState: "disabled",
          orgId,
          pendingOperation: null,
          pluginId,
          selectedVersion: targetVersion,
        });
      } catch (error) {
        if (error instanceof PluginHostError && error.code === "interrupted") {
          throw error;
        }
        if (!published) {
          await this.discardUnpublishedGeneration(
            orgId,
            pluginId,
            install.databaseGeneration,
            targetGeneration
          );
          await this.writeOrgPluginState({
            databaseGeneration: install.databaseGeneration,
            expectedRevision: updating.revision,
            lastLifecycleError: lifecycleErrorMessage(error),
            lifecycleState: "disabled",
            orgId,
            pendingOperation: null,
            pluginId,
            selectedVersion: install.selectedVersion,
          }).catch(() => undefined);
        }
        if (error instanceof PluginHostError) {
          throw error;
        }
        throw new PluginHostError(
          "migration_failed",
          lifecycleErrorMessage(error)
        );
      }
    });
  }

  async uninstallOrgPlugin(
    orgId: string,
    pluginId: string,
    expectedRevision: number
  ): Promise<StoredOrgPluginRecord> {
    return this.withOrgPluginMutation(orgId, pluginId, async () => {
      const install = await this.requireOrgPlugin(orgId, pluginId);
      if (install.revision !== expectedRevision) {
        throw new PluginHostError("stale_revision");
      }
      if (
        install.lifecycleState !== "disabled" &&
        install.lifecycleState !== "retained"
      ) {
        throw new PluginHostError("invalid_state");
      }

      await this.closePluginAdmission(orgId, pluginId);
      return this.writeOrgPluginState({
        databaseGeneration: install.databaseGeneration,
        expectedRevision,
        lastLifecycleError: null,
        lifecycleState: "retained",
        orgId,
        pendingOperation: null,
        pluginId,
        selectedVersion: install.selectedVersion,
      });
    });
  }

  async deleteRetainedPluginData(
    orgId: string,
    pluginId: string,
    expectedRevision: number
  ): Promise<void> {
    return this.withOrgPluginMutation(orgId, pluginId, async () => {
      const install = await this.requireOrgPlugin(orgId, pluginId);
      if (install.revision !== expectedRevision) {
        throw new PluginHostError("stale_revision");
      }
      if (install.lifecycleState !== "retained") {
        throw new PluginHostError("invalid_state");
      }
      const deleted = await this.db.deleteOrgPlugin(
        orgId,
        pluginId,
        expectedRevision
      );
      if (!deleted) {
        throw new PluginHostError("stale_revision");
      }
      await rm(getOrgPluginDataDir(orgId, pluginId, this.configDir), {
        force: true,
        recursive: true,
      });
    });
  }

  async listApprovedPluginReleases(
    pluginId?: string
  ): Promise<PluginReleaseSummary[]> {
    return this.db.listPluginReleases(pluginId);
  }

  async listOrgPluginDetails(orgId: string): Promise<OrgPluginDetail[]> {
    const releases = await this.db.listPluginReleases();
    const installs = await this.db.listOrgPlugins(orgId);
    const pluginIds = [
      ...new Set([
        ...releases.map((release) => release.pluginId),
        ...installs.map((install) => install.pluginId),
      ]),
    ].sort();
    const details: OrgPluginDetail[] = [];
    for (const pluginId of pluginIds) {
      const detail = await this.getOrgPluginDetail(orgId, pluginId);
      if (detail) {
        details.push(detail);
      }
    }
    return details;
  }

  async getOrgPluginDetail(
    orgId: string,
    pluginId: string
  ): Promise<OrgPluginDetail | null> {
    const releases = await this.db.listPluginReleases(pluginId);
    const install = await this.db.getOrgPlugin(orgId, pluginId);
    if (releases.length === 0 && !install) {
      return null;
    }

    const selected =
      (install?.selectedVersion
        ? releases.find(
            (release) => release.version === install.selectedVersion
          )
        : null) ??
      releases.at(-1) ??
      null;
    const manifest = selected?.manifest ?? null;

    return {
      actions: actionDescriptions(manifest),
      availableVersions: releases.map((release) => release.version),
      databaseGeneration: install?.databaseGeneration ?? null,
      description: manifest?.description ?? "",
      installed: Boolean(install),
      lastLifecycleError: install?.lastLifecycleError ?? null,
      lifecycleState: install?.lifecycleState ?? "disabled",
      name: manifest?.name ?? pluginId,
      pendingOperation: install?.pendingOperation ?? null,
      pluginId,
      revision: install?.revision ?? 0,
      selectedVersion: install?.selectedVersion ?? selected?.version ?? null,
      ui: manifest?.ui
        ? {
            assetsDir: manifest.ui.assetsDir,
            entryModule: manifest.ui.entryModule,
            pageLabel: manifest.ui.pageLabel,
          }
        : null,
      updatedAt: install?.updatedAt ?? selected?.createdAt ?? "",
    };
  }

  async removePluginRelease(pluginId: string, version: string): Promise<void> {
    return withPluginMutation(async () => {
      const release = await this.db.getPluginRelease(pluginId, version);
      if (!release) {
        throw new PluginHostError("not_found");
      }

      const dependents = (await this.db.listOrgPlugins()).filter(
        (install) =>
          install.pluginId === pluginId && install.selectedVersion === version
      );
      if (dependents.length > 0) {
        throw new PluginHostError("in_use");
      }

      const deleted = await this.db.deletePluginRelease(pluginId, version);
      if (!deleted) {
        throw new PluginHostError("not_found");
      }

      await rm(getPluginReleaseDir(pluginId, version, this.configDir), {
        force: true,
        recursive: true,
      });
    });
  }

  async resolveEnabledUiAsset(
    orgId: string,
    pluginId: string,
    assetPath: string
  ): Promise<{ isDocument: boolean; path: string } | null> {
    const install = await this.db.getOrgPlugin(orgId, pluginId);
    if (
      !(
        install &&
        install.lifecycleState === "enabled" &&
        install.selectedVersion
      )
    ) {
      return null;
    }

    const release = await this.db.getPluginRelease(
      pluginId,
      install.selectedVersion
    );
    const ui = release?.manifest.ui;
    if (!ui) {
      return null;
    }

    const uiDirectory = dirname(ui.entryModule);
    const relativePath =
      assetPath === ""
        ? ui.entryModule
        : uiDirectory === "."
          ? assetPath
          : `${uiDirectory}/${assetPath}`;
    if (!isUiReleasePath(ui, relativePath)) {
      return null;
    }

    const releaseDir = getPluginReleaseDir(
      pluginId,
      install.selectedVersion,
      this.configDir
    );
    try {
      const resolved = resolvePluginReleaseEntry(releaseDir, relativePath);
      if (!(await pathExists(resolved))) {
        return null;
      }
      return {
        isDocument: relativePath.endsWith(".html"),
        path: resolved,
      };
    } catch {
      return null;
    }
  }

  async recoverInterruptedPluginOperations(): Promise<void> {
    return withPluginMutation(async () => {
      const installs = await this.db.listOrgPlugins();
      for (const install of installs) {
        try {
          await this.recoverOneInstall(install);
        } catch (error) {
          await this.writeOrgPluginState({
            databaseGeneration: install.databaseGeneration,
            expectedRevision: install.revision,
            lastLifecycleError: lifecycleErrorMessage(error),
            lifecycleState:
              install.lifecycleState === "enabled" ? "disabled" : "disabled",
            orgId: install.orgId,
            pendingOperation: null,
            pluginId: install.pluginId,
            selectedVersion: install.selectedVersion,
          }).catch(() => undefined);
        }
      }
    });
  }

  private async assertToolAssignment(
    input: InvokePluginActionInput
  ): Promise<void> {
    const profileId = input.profileId?.trim();
    if (!profileId) {
      throw new PluginHostError("invalid_input");
    }

    const profile = await this.db.getProfileForOrg(profileId, input.orgId);
    if (!profile) {
      throw new PluginHostError("forbidden");
    }

    const assigned = await this.db.listToolsForProfile(profileId);
    const ok = assigned.some(
      (tool) =>
        tool.handlerType === "plugin" &&
        tool.pluginId === input.pluginId &&
        tool.pluginKey === input.actionKey
    );
    if (!ok) {
      throw new PluginHostError("forbidden");
    }
  }

  private async admitInvocation(
    orgId: string,
    pluginId: string
  ): Promise<{
    handle: {
      abort: AbortController;
      invocationId: string;
      release: () => void;
    };
    install: NonNullable<Awaited<ReturnType<DatabaseAdapter["getOrgPlugin"]>>>;
    manifest: PluginManifest;
    releaseDir: string;
  }> {
    const gate = admissionGateFor(orgId, pluginId);
    return withAdmissionGate(gate, async () => {
      if (gate.closed) {
        throw new PluginHostError("admission_closed");
      }

      const install = await this.db.getOrgPlugin(orgId, pluginId);
      if (!(install && install.selectedVersion)) {
        throw new PluginHostError("not_installed");
      }
      if (install.lifecycleState !== "enabled") {
        throw new PluginHostError("not_enabled");
      }
      if (gate.active >= MAX_PLUGIN_INVOCATIONS) {
        throw new PluginHostError("busy");
      }

      const release = await this.db.getPluginRelease(
        pluginId,
        install.selectedVersion
      );
      if (!release) {
        throw new PluginHostError("not_installed");
      }

      const releaseDir = getPluginReleaseDir(
        pluginId,
        install.selectedVersion,
        this.configDir
      );
      if (!(await pathExists(releaseDir))) {
        throw new PluginHostError("not_installed");
      }

      // Check immediately before reserving the handle, after all asynchronous
      // lookups, so a pending admission cannot slip into an active snapshot.
      if (exportPending) {
        throw new PluginHostError("admission_closed");
      }
      gate.active += 1;
      const abort = new AbortController();
      gate.controllers.add(abort);
      return {
        handle: {
          abort,
          invocationId: randomUUID(),
          release: () => {
            gate.controllers.delete(abort);
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

    const generation = input.install.databaseGeneration;
    if (generation) {
      context.databasePath = getOrgPluginDatabasePath(
        input.orgId,
        input.pluginId,
        generation,
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
      throw new PluginHostError("invalid_entry");
    }
    if (!(await pathExists(entryPath))) {
      throw new PluginHostError("invalid_entry");
    }

    await ensureDir(input.context.dataDir);

    return spawnJsonTool({
      args: ["--no-install", PLUGIN_RUNNER_PATH, entryPath],
      bin: BUN_BIN,
      context: { signal: input.signal },
      cwd: input.releaseDir,
      input: { context: input.context, input: input.input },
      label: input.label,
      transport: {
        includeConfigDir: false,
        onHostRequest: this.options.onHostRequest
          ? (request, signal) =>
              this.options.onHostRequest!(
                request,
                input.context,
                mergeAbortSignals(input.signal, signal)
              )
          : undefined,
        timeoutMs:
          input.context.pluginId === "workflows" &&
          input.context.actionKey === "run_workflow"
            ? 300_000
            : undefined,
      },
      workspaceRoot: input.context.workspaceRoot,
    });
  }

  private withOrgPluginMutation<T>(
    orgId: string,
    pluginId: string,
    work: () => Promise<T>
  ): Promise<T> {
    // Keep the lock through filesystem cleanup, after revision checks can no
    // longer protect an installation whose database record has been deleted.
    return withPluginMutation(() =>
      withKeyedLock(
        lifecycleLocks,
        getOrgPluginDataDir(orgId, pluginId, this.configDir),
        work
      )
    );
  }

  private openPluginAdmission(orgId: string, pluginId: string): void {
    admissionGateFor(orgId, pluginId).closed = false;
  }

  private async requireOrgPlugin(
    orgId: string,
    pluginId: string
  ): Promise<StoredOrgPluginRecord> {
    const install = await this.db.getOrgPlugin(orgId, pluginId);
    if (!install) {
      throw new PluginHostError("not_found");
    }
    return install;
  }

  private async resolveApprovedRelease(pluginId: string, version?: string) {
    if (version) {
      return this.db.getPluginRelease(pluginId, version);
    }
    const releases = await this.db.listPluginReleases(pluginId);
    return (
      releases.sort((left, right) =>
        compareSemver(right.version, left.version)
      )[0] ?? null
    );
  }

  private async writeOrgPluginState(input: {
    databaseGeneration: string | null;
    expectedRevision: number;
    lastLifecycleError?: string | null;
    lifecycleState: StoredOrgPluginRecord["lifecycleState"];
    orgId: string;
    pendingOperation?: string | null;
    pluginId: string;
    selectedVersion: string | null;
  }): Promise<StoredOrgPluginRecord> {
    const result = await this.db.compareAndSetOrgPluginState({
      databaseGeneration: input.databaseGeneration,
      expectedRevision: input.expectedRevision,
      lastLifecycleError: input.lastLifecycleError ?? null,
      lifecycleState: input.lifecycleState,
      now: new Date().toISOString(),
      orgId: input.orgId,
      pendingOperation: input.pendingOperation ?? null,
      pluginId: input.pluginId,
      selectedVersion: input.selectedVersion,
    });
    if (!result.ok) {
      throw new PluginHostError("stale_revision");
    }
    const saved = await this.db.getOrgPlugin(input.orgId, input.pluginId);
    if (!saved) {
      throw new PluginHostError("not_found");
    }
    return saved;
  }

  private async publishInstallation(input: {
    databaseGeneration: string | null;
    expectedRevision: number;
    lastLifecycleError: string | null;
    lifecycleState: StoredOrgPluginRecord["lifecycleState"];
    manifest: PluginManifest;
    orgId: string;
    pendingOperation: string | null;
    pluginId: string;
    selectedVersion: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.db.publishOrgPluginRelease({
      contributions: materializeContributions(
        input.orgId,
        input.pluginId,
        input.manifest,
        now
      ),
      databaseGeneration: input.databaseGeneration,
      expectedRevision: input.expectedRevision,
      lastLifecycleError: input.lastLifecycleError,
      lifecycleState: input.lifecycleState,
      now,
      orgId: input.orgId,
      pendingOperation: input.pendingOperation,
      pluginId: input.pluginId,
      selectedVersion: input.selectedVersion,
    });
    if (!result.ok) {
      throw new PluginHostError(
        result.reason === "stale_revision" ? "stale_revision" : "invalid_state"
      );
    }
  }

  private assertContributionNames(
    pluginId: string,
    manifest: PluginManifest
  ): void {
    for (const action of manifest.actions) {
      if (!action.exposeAsTool) {
        continue;
      }
      if (!derivePluginToolName(pluginId, action.key)) {
        throw new PluginHostError("invalid_state");
      }
    }
  }

  private async planDatabaseGeneration(
    orgId: string,
    pluginId: string,
    install: StoredOrgPluginRecord,
    manifest: PluginManifest
  ): Promise<string | null> {
    const migrations = manifest.database?.migrations ?? [];
    if (migrations.length === 0) {
      return install.databaseGeneration;
    }
    if (!install.databaseGeneration) {
      return newDatabaseGeneration();
    }
    const selectedPath = getOrgPluginDatabasePath(
      orgId,
      pluginId,
      install.databaseGeneration,
      this.configDir
    );
    if (!(await pathExists(selectedPath))) {
      return newDatabaseGeneration();
    }
    const pending = await this.countPendingMigrations(selectedPath, manifest);
    return pending > 0 ? newDatabaseGeneration() : install.databaseGeneration;
  }

  private async countPendingMigrations(
    databasePath: string,
    manifest: PluginManifest
  ): Promise<number> {
    const migrations = await this.loadMigrationFiles(manifest);
    const db = new Database(databasePath);
    try {
      ensureMigrationLedger(db);
      const applied = readAppliedMigrations(db);
      assertMigrationCompatibility(applied, migrations);
      return migrations.filter(
        (migration) => !applied.some((row) => row.id === migration.id)
      ).length;
    } finally {
      db.close();
    }
  }

  private async preparePluginDatabase(input: {
    install: StoredOrgPluginRecord;
    manifest: PluginManifest;
    orgId: string;
    pluginId: string;
    targetGeneration: string | null;
    version: string;
  }): Promise<void> {
    if (!input.targetGeneration) {
      return;
    }
    const targetPath = getOrgPluginDatabasePath(
      input.orgId,
      input.pluginId,
      input.targetGeneration,
      this.configDir
    );
    await ensureDir(dirname(targetPath));
    const sourceGeneration = input.install.databaseGeneration;
    if (
      sourceGeneration &&
      sourceGeneration !== input.targetGeneration &&
      (await pathExists(
        getOrgPluginDatabasePath(
          input.orgId,
          input.pluginId,
          sourceGeneration,
          this.configDir
        )
      ))
    ) {
      await vacuumPluginDatabaseInto(
        getOrgPluginDatabasePath(
          input.orgId,
          input.pluginId,
          sourceGeneration,
          this.configDir
        ),
        targetPath
      );
    }

    const migrations = await this.loadMigrationFiles(input.manifest);
    applyPluginMigrations(targetPath, migrations);
  }

  private async loadMigrationFiles(
    manifest: PluginManifest
  ): Promise<Array<{ checksum: string; id: string; sql: string }>> {
    const releaseDir = getPluginReleaseDir(
      manifest.id,
      manifest.version,
      this.configDir
    );
    const loaded: Array<{ checksum: string; id: string; sql: string }> = [];
    for (const migration of manifest.database?.migrations ?? []) {
      const path = resolvePluginReleaseEntry(releaseDir, migration.path);
      const sql = await readFile(path, "utf8");
      loaded.push({
        checksum: createHash("sha256").update(sql).digest("hex"),
        id: migration.id,
        sql,
      });
    }
    return loaded;
  }

  private async discardUnpublishedGeneration(
    orgId: string,
    pluginId: string,
    selectedGeneration: string | null,
    targetGeneration: string | null
  ): Promise<void> {
    if (!targetGeneration || targetGeneration === selectedGeneration) {
      return;
    }
    await rm(
      getOrgPluginDatabasePath(
        orgId,
        pluginId,
        targetGeneration,
        this.configDir
      ),
      { force: true }
    );
  }

  private async assertReinstallCompatible(
    orgId: string,
    pluginId: string,
    install: StoredOrgPluginRecord,
    manifest: PluginManifest
  ): Promise<void> {
    if (!install.databaseGeneration) {
      return;
    }
    const databasePath = getOrgPluginDatabasePath(
      orgId,
      pluginId,
      install.databaseGeneration,
      this.configDir
    );
    if (!(await pathExists(databasePath))) {
      if (
        install.selectedVersion &&
        install.selectedVersion !== manifest.version
      ) {
        throw new PluginHostError("incompatible");
      }
      return;
    }
    try {
      await this.countPendingMigrations(databasePath, manifest);
    } catch (error) {
      if (error instanceof PluginHostError) {
        throw error;
      }
      throw new PluginHostError("incompatible");
    }
  }

  private async recoverOneInstall(
    install: StoredOrgPluginRecord
  ): Promise<void> {
    const pending = parsePending(install.pendingOperation);
    const transient =
      install.lifecycleState === "enabling" ||
      install.lifecycleState === "disabling" ||
      install.lifecycleState === "updating";

    if (transient) {
      const published = isPublishedPair(install, pending);
      const recovered = await this.writeOrgPluginState({
        databaseGeneration: install.databaseGeneration,
        expectedRevision: install.revision,
        lastLifecycleError: install.lastLifecycleError,
        lifecycleState: "disabled",
        orgId: install.orgId,
        pendingOperation: null,
        pluginId: install.pluginId,
        selectedVersion: install.selectedVersion,
      });
      if (
        pending?.targetGeneration &&
        !published &&
        pending.targetGeneration !== recovered.databaseGeneration
      ) {
        await this.discardUnpublishedGeneration(
          install.orgId,
          install.pluginId,
          recovered.databaseGeneration,
          pending.targetGeneration
        );
      }
    }

    const current =
      (await this.db.getOrgPlugin(install.orgId, install.pluginId)) ?? install;
    const missing = await this.describeMissingPluginBytes(current);
    if (!missing) {
      return;
    }
    if (
      current.lastLifecycleError === missing &&
      current.lifecycleState !== "enabled"
    ) {
      return;
    }
    await this.writeOrgPluginState({
      databaseGeneration: current.databaseGeneration,
      expectedRevision: current.revision,
      lastLifecycleError: missing,
      lifecycleState: "disabled",
      orgId: current.orgId,
      pendingOperation: null,
      pluginId: current.pluginId,
      selectedVersion: current.selectedVersion,
    }).catch(() => undefined);
  }

  private async describeMissingPluginBytes(
    install: StoredOrgPluginRecord
  ): Promise<string | null> {
    if (install.selectedVersion) {
      const releaseDir = getPluginReleaseDir(
        install.pluginId,
        install.selectedVersion,
        this.configDir
      );
      if (!(await pathExists(releaseDir))) {
        return "package_unavailable";
      }
      if (
        !(await pluginReleaseIntegrityMatches(
          install.pluginId,
          install.selectedVersion,
          this.configDir
        ))
      ) {
        return "package_unavailable";
      }
    }
    if (install.databaseGeneration) {
      const databasePath = getOrgPluginDatabasePath(
        install.orgId,
        install.pluginId,
        install.databaseGeneration,
        this.configDir
      );
      if (!(await pathExists(databasePath))) {
        return "database_unavailable";
      }
      try {
        const db = new Database(databasePath);
        db.close();
      } catch {
        return "database_unavailable";
      }
    }
    return null;
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
      throw new PluginHostError("version_conflict");
    }

    if (existing?.digest === digest && (await pathExists(releaseDir))) {
      await writePluginReleaseIntegrity(
        manifest.id,
        manifest.version,
        this.configDir
      );
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
        throw new PluginHostError("version_conflict");
      }

      await writePluginReleaseIntegrity(
        manifest.id,
        manifest.version,
        this.configDir
      );

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

function actionDescriptions(
  manifest: PluginManifest | null
): PluginActionDescription[] {
  return (
    manifest?.actions.map((action) => ({
      access: action.access,
      description: action.description,
      effect: action.effect,
      key: action.key,
    })) ?? []
  );
}

function isUiReleasePath(
  ui: PluginUiContribution,
  relativePath: string
): boolean {
  if (relativePath === ui.entryModule) {
    return true;
  }
  const assetsDir = ui.assetsDir.replace(/\/+$/, "");
  return relativePath === assetsDir || relativePath.startsWith(`${assetsDir}/`);
}

function toPreview(inspected: InspectedPackage): PluginPackagePreview {
  return {
    contributions: {
      actionKeys: inspected.manifest.actions.map((action) => action.key),
      hasDatabase: Boolean(inspected.manifest.database?.migrations.length),
      hasUi: Boolean(inspected.manifest.ui),
      skillKeys: inspected.manifest.skills.map((skill) => skill.key),
    },
    digest: inspected.digest,
    integrity: inspected.integrity,
    manifest: inspected.manifest,
  };
}

async function inspectPluginPackage(
  source: PluginPackageRequest,
  expectedIntegrity?: string
): Promise<InspectedPackage> {
  if (
    !source ||
    typeof source.packageName !== "string" ||
    source.packageName.length > 214 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(
      source.packageName
    ) ||
    typeof source.version !== "string" ||
    source.version.length > 128 ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      source.version
    )
  ) {
    throw new PluginHostError("invalid_package");
  }
  const spec = `${source.packageName}@${source.version}`;
  const options = {
    allowDirectory: "none",
    allowFile: "none",
    allowGit: "none",
    allowRemote: "none",
    fetchRetries: 0,
    fullMetadata: true,
    ignoreScripts: true,
    preferOnline: true,
    registry: "https://registry.npmjs.org/",
    signal: AbortSignal.timeout(30_000),
    timeout: 30_000,
  } as const;
  let archive: Buffer;
  let integrity: string;
  try {
    const metadata = await pacote.manifest(spec, options);
    integrity = metadata.dist?.integrity ?? "";
    const tarball = new URL(metadata.dist?.tarball ?? "");
    if (
      metadata.name !== source.packageName ||
      metadata.version !== source.version ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) ||
      tarball.protocol !== "https:" ||
      tarball.hostname !== "registry.npmjs.org" ||
      tarball.port ||
      tarball.username ||
      tarball.password
    ) {
      throw new PluginHostError("invalid_package");
    }
    if (expectedIntegrity !== undefined && integrity !== expectedIntegrity) {
      throw new PluginHostError("digest_mismatch");
    }
    archive = await pacote.tarball.stream(
      tarball.href,
      async (stream) => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > MAX_COMPRESSED_BYTES) {
            throw new PluginHostError("archive_too_large");
          }
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      },
      { ...options, allowRemote: "all", integrity }
    );
  } catch (error) {
    if (error instanceof PluginHostError) {
      throw error;
    }
    throw new PluginHostError("package_unavailable");
  }

  const files = await readNpmPackage(archive);
  let manifest: unknown;
  let packageJson: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(
      Buffer.from(files.get(PLUGIN_MANIFEST_FILENAME) ?? []).toString()
    );
    packageJson = JSON.parse(
      Buffer.from(files.get("package.json") ?? []).toString()
    );
  } catch {
    throw new PluginHostError("invalid_manifest");
  }
  const validated = validatePluginManifest(manifest);
  if (
    !validated.ok ||
    validated.manifest.version !== source.version ||
    !packageJson ||
    packageJson.name !== source.packageName ||
    packageJson.version !== source.version ||
    [
      packageJson.dependencies,
      packageJson.optionalDependencies,
      packageJson.peerDependencies,
    ].some((deps) => Object.keys(deps ?? {}).length > 0)
  ) {
    throw new PluginHostError("invalid_manifest");
  }
  assertReferencedFilesExist(validated.manifest, files);
  return {
    digest: digestArchive(archive),
    files,
    integrity,
    manifest: validated.manifest,
  };
}

async function readNpmPackage(
  archive: Uint8Array
): Promise<Map<string, Uint8Array>> {
  let unpacked: Buffer;
  try {
    // Include tar headers and metadata in the expansion budget, not just file bodies.
    unpacked = gunzipSync(archive, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch {
    throw new PluginHostError("invalid_archive");
  }
  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let count = 0;
  await new Promise<void>((resolveRead, reject) => {
    const parser = new Parser({
      filter(path, entry) {
        try {
          count += 1;
          if (count > MAX_FILES || entry.size > MAX_FILE_BYTES) {
            throw new PluginHostError("expansion_limit");
          }
          if (Buffer.byteLength(path) > MAX_PATH_BYTES) {
            throw new PluginHostError("unsafe_path");
          }
          const name = normalizeArchivePath(path);
          if (seen.has(name)) {
            throw new PluginHostError("duplicate_entry");
          }
          seen.add(name);
          if (
            !("type" in entry) ||
            (entry.type !== "File" && entry.type !== "Directory")
          ) {
            throw new PluginHostError("unsupported_entry");
          }
          if (
            !(
              (name === "package" && entry.type === "Directory") ||
              name.startsWith("package/")
            )
          ) {
            throw new PluginHostError("unsafe_path");
          }
          return entry.type === "File";
        } catch (error) {
          reject(error);
          parser.abort(
            error instanceof Error ? error : new Error(String(error))
          );
          return false;
        }
      },
      onReadEntry(entry) {
        const chunks: Buffer[] = [];
        entry.on("data", (chunk: Buffer) => chunks.push(chunk));
        entry.on("end", () =>
          files.set(entry.path.slice("package/".length), Buffer.concat(chunks))
        );
      },
      strict: true,
    });
    parser.on("error", () => reject(new PluginHostError("invalid_archive")));
    parser.on("end", resolveRead);
    parser.end(unpacked);
  });
  return files;
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
    throw new PluginHostError("unsafe_path");
  }
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = trimmed.split("/");
  if (
    parts.length === 0 ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new PluginHostError("unsafe_path");
  }
  return parts.join("/");
}

function assertReferencedFilesExist(
  manifest: PluginManifest,
  files: Map<string, Uint8Array>
): void {
  for (const skill of manifest.skills) {
    if (!hasPrefix(files, skill.directory)) {
      throw new PluginHostError("missing_referenced_file");
    }
  }
  for (const action of manifest.actions) {
    if (!files.has(action.entry)) {
      throw new PluginHostError("missing_referenced_file");
    }
  }
  if (
    manifest.ui &&
    !(
      files.has(manifest.ui.entryModule) &&
      hasPrefix(files, manifest.ui.assetsDir)
    )
  ) {
    throw new PluginHostError("missing_referenced_file");
  }
  for (const migration of manifest.database?.migrations ?? []) {
    if (!files.has(migration.path)) {
      throw new PluginHostError("missing_referenced_file");
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
      throw new PluginHostError("unsafe_path");
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

async function writePluginReleaseIntegrity(
  pluginId: string,
  version: string,
  configDir: string
): Promise<void> {
  const releaseDir = getPluginReleaseDir(pluginId, version, configDir);
  const digest = await hashPluginReleaseTree(releaseDir);
  await writeFile(
    pluginReleaseIntegrityPath(pluginId, version, configDir),
    `${digest}\n`,
    { mode: 0o600 }
  );
}

async function pluginReleaseIntegrityMatches(
  pluginId: string,
  version: string,
  configDir: string
): Promise<boolean> {
  const integrityPath = pluginReleaseIntegrityPath(
    pluginId,
    version,
    configDir
  );
  if (!(await pathExists(integrityPath))) {
    return true;
  }
  const expected = (await readFile(integrityPath, "utf8")).trim();
  const actual = await hashPluginReleaseTree(
    getPluginReleaseDir(pluginId, version, configDir)
  );
  return expected === actual;
}

export async function quarantineInvalidPluginReleases(
  configDir: string
): Promise<string[]> {
  const root = getPluginsRootDir(configDir);
  if (!(await pathExists(root))) {
    return [];
  }
  const quarantined: string[] = [];
  for (const plugin of await readdir(root, { withFileTypes: true })) {
    if (!plugin.isDirectory() || plugin.name.startsWith(".")) {
      continue;
    }
    const pluginDir = join(root, plugin.name);
    for (const entry of await readdir(pluginDir, { withFileTypes: true })) {
      if (!(entry.isFile() && entry.name.endsWith(".integrity"))) {
        continue;
      }
      const version = entry.name.slice(0, -".integrity".length);
      if (
        await pluginReleaseIntegrityMatches(plugin.name, version, configDir)
      ) {
        continue;
      }
      const releaseDir = getPluginReleaseDir(plugin.name, version, configDir);
      if (await pathExists(releaseDir)) {
        await rename(releaseDir, `${releaseDir}.unavailable`);
        quarantined.push(`${plugin.name}@${version}`);
      }
    }
  }
  return quarantined;
}

async function hashPluginReleaseTree(releaseDir: string): Promise<string> {
  const files: string[] = [];
  await collectReleaseFiles(releaseDir, releaseDir, files);
  files.sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(join(releaseDir, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectReleaseFiles(
  root: string,
  current: string,
  out: string[]
): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectReleaseFiles(root, absolute, out);
    } else if (entry.isFile()) {
      out.push(relative(root, absolute).split(sep).join("/"));
    }
  }
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
    controllers: new Set(),
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

async function drainAdmissionGate(
  gate: AdmissionGate,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (gate.active > 0 && Date.now() < deadline) {
    await Bun.sleep(20);
  }
}

function mergeAbortSignals(
  left?: AbortSignal,
  right?: AbortSignal
): AbortSignal | undefined {
  return left && right ? AbortSignal.any([left, right]) : (left ?? right);
}

function serializePending(pending: PendingPluginOperation): string {
  return JSON.stringify(pending);
}

function parsePending(raw: string | null): PendingPluginOperation | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PendingPluginOperation;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isPublishedPair(
  install: StoredOrgPluginRecord,
  pending: PendingPluginOperation | null
): boolean {
  if (!pending) {
    return false;
  }
  return (
    install.selectedVersion === pending.targetVersion &&
    install.databaseGeneration === pending.targetGeneration
  );
}

function newDatabaseGeneration(): string {
  return `g${randomUUID().replaceAll("-", "")}`;
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split("-")[0]?.split(".").map(Number) ?? [];
  const rightParts = right.split("-")[0]?.split(".").map(Number) ?? [];
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function lifecycleErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function materializeContributions(
  orgId: string,
  pluginId: string,
  manifest: PluginManifest,
  now: string
): { skills: StoredSkillRecord[]; tools: StoredToolRecord[] } {
  return {
    skills: manifest.skills.map((skill) => ({
      createdAt: now,
      createdBy: "human",
      description: manifest.name,
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: randomUUID(),
      name: skill.key,
      orgId,
      pluginId,
      pluginKey: skill.key,
      sourcePath: `plugins/${pluginId}/${skill.key}`,
      updatedAt: now,
    })),
    tools: manifest.actions
      .filter((action) => action.exposeAsTool)
      .map((action) => ({
        createdAt: now,
        description: action.description,
        handlerConfig: { actionKey: action.key },
        handlerType: "plugin",
        id: randomUUID(),
        name: derivePluginToolName(pluginId, action.key) ?? "",
        orgId,
        pluginId,
        pluginKey: action.key,
        updatedAt: now,
      })),
  };
}

function ensureMigrationLedger(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function readAppliedMigrations(
  db: Database
): Array<{ checksum: string; id: string }> {
  return db
    .query(
      `SELECT id, checksum FROM ${MIGRATION_LEDGER_TABLE} ORDER BY applied_at ASC`
    )
    .all() as Array<{ checksum: string; id: string }>;
}

function assertMigrationCompatibility(
  applied: Array<{ checksum: string; id: string }>,
  incoming: Array<{ checksum: string; id: string }>
): void {
  if (applied.length > incoming.length) {
    throw new PluginHostError("incompatible", "migration downgrade");
  }
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  for (const row of applied) {
    const expected = incomingById.get(row.id);
    if (!expected) {
      throw new PluginHostError("incompatible", "migration downgrade");
    }
    if (expected.checksum !== row.checksum) {
      throw new PluginHostError("incompatible", "checksum_mismatch");
    }
  }
}

function applyPluginMigrations(
  databasePath: string,
  migrations: Array<{ checksum: string; id: string; sql: string }>
): void {
  const db = new Database(databasePath);
  try {
    ensureMigrationLedger(db);
    const applied = readAppliedMigrations(db);
    assertMigrationCompatibility(applied, migrations);
    const appliedIds = new Set(applied.map((row) => row.id));
    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        continue;
      }
      db.exec(migration.sql);
      db.query(
        `INSERT INTO ${MIGRATION_LEDGER_TABLE} (id, checksum, applied_at) VALUES (?, ?, ?)`
      ).run(migration.id, migration.checksum, new Date().toISOString());
    }
  } catch (error) {
    if (error instanceof PluginHostError) {
      throw error;
    }
    throw new PluginHostError("migration_failed", lifecycleErrorMessage(error));
  } finally {
    db.close();
  }
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function actorMayInvoke(
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

const stagingLocks = new Map<string, Promise<unknown>>();

async function withKeyedLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseLock = () => {};
  const current = new Promise<void>((resolveLock) => {
    releaseLock = resolveLock;
  });
  const chained = previous.then(() => current);
  locks.set(key, chained);
  await previous;
  try {
    return await work();
  } finally {
    releaseLock();
    if (locks.get(key) === chained) {
      locks.delete(key);
    }
  }
}
