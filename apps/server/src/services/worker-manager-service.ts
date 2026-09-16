import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerLogsResponse, WorkerProcessInfo } from "@nakama/core";
import {
  type PlatformWorkerName,
  type PluginWorkerContribution,
  readRuntimeServerUrl,
  readWorkerDesiredState,
  resolvePluginReleaseEntry,
  setWorkerDesiredRunning,
} from "@nakama/core";

const WORKER_SCRIPTS: Record<string, string> = {
  automation: "apps/platform/automation/src/index.ts",
  discord: "apps/platform/discord/src/index.ts",
  telegram: "apps/platform/telegram/src/index.ts",
  whatsapp: "apps/platform/whatsapp/src/index.ts",
};

const WORKER_DIST_SCRIPTS: Partial<Record<string, string>> = {
  automation: "apps/platform/automation/dist/index.js",
  discord: "apps/platform/discord/dist/index.js",
  telegram: "apps/platform/telegram/dist/index.js",
  whatsapp: "apps/platform/whatsapp/dist/index.js",
};

const VALID_WORKERS = Object.keys(WORKER_SCRIPTS);

export interface PluginWorkerRegistration {
  configDir?: string;
  dataDir: string;
  orgId: string;
  pluginId: string;
  releaseDir: string;
  version: string;
  workers: PluginWorkerContribution[];
}

interface RegisteredPluginWorker {
  contribution: PluginWorkerContribution;
  directory: string;
  registration: PluginWorkerRegistration;
  script: string;
}

function promisifyPm2<T>(
  fn: (cb: (err: Error | null, result?: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result as T);
      }
    });
  });
}

export class WorkerManagerService {
  private readonly pluginWorkers = new Map<string, RegisteredPluginWorker>();
  private pluginWorkersPaused = false;
  private pm2Queue: Promise<unknown> = Promise.resolve();
  private pm2Module: typeof import("pm2") | null = null;

  constructor(
    private readonly projectRoot: string,
    pm2?: typeof import("pm2"),
    private readonly getWorkerLlm?: (providerType?: "openai") => unknown
  ) {
    this.pm2Module = pm2 ?? null;
  }

  private async ensurePm2(): Promise<NonNullable<typeof import("pm2")>> {
    if (this.pm2Module) {
      return this.pm2Module;
    }

    try {
      const mod = await import("pm2");
      const pm2 = (mod.default ?? mod) as NonNullable<typeof import("pm2")>;
      this.pm2Module = pm2;
      return pm2;
    } catch {
      throw new Error(
        "PM2 is not available. Install it with: npm install -g pm2"
      );
    }
  }

  private async withPm2<T>(
    action: (pm2: NonNullable<typeof import("pm2")>) => Promise<T>
  ): Promise<T> {
    const operation = this.pm2Queue
      .catch(() => {})
      .then(async () => {
        const pm2 = await this.ensurePm2();
        await promisifyPm2<void>((cb) => pm2.connect(cb));
        try {
          return await action(pm2);
        } finally {
          pm2.disconnect();
        }
      });
    this.pm2Queue = operation;
    return operation;
  }

  async registerPluginWorkers(
    registration: PluginWorkerRegistration,
    start: boolean
  ): Promise<void> {
    for (const contribution of registration.workers) {
      const name =
        "plugin-" +
        createHash("sha256")
          .update(
            JSON.stringify([
              registration.dataDir,
              registration.orgId,
              registration.pluginId,
              contribution.key,
            ])
          )
          .digest("hex")
          .slice(0, 32);
      const script = resolvePluginReleaseEntry(
        registration.releaseDir,
        contribution.entry
      );
      if (!existsSync(script)) {
        throw new Error("Plugin worker entry is missing");
      }
      const directory = join(registration.dataDir, "workers", contribution.key);
      await mkdir(directory, { mode: 0o700, recursive: true });
      this.pluginWorkers.set(name, {
        contribution,
        directory,
        registration,
        script,
      });
      let desired = true;
      try {
        desired = JSON.parse(
          await readFile(join(directory, "desired.json"), "utf8")
        );
        if (typeof desired !== "boolean") {
          throw new Error("Invalid worker desired state");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      if (start) {
        await this.startWorker(name);
      } else if (desired) {
        const process = (await this.listAllPm2Processes()).find(
          (item) => item.name === name
        );
        if (
          process?.pm2_env?.status !== "online" ||
          process.pm2_env.NAKAMA_PLUGIN_VERSION !== registration.version
        ) {
          await this.startWorker(name);
        }
      }
    }
  }

  private async deletePluginProcess(pm2: typeof import("pm2"), name: string) {
    const existing = await promisifyPm2<Pm2ProcessDescription[]>((cb) =>
      pm2.describe(name, cb)
    );
    if (existing.length) {
      await promisifyPm2<void>((cb) => pm2.delete(name, (error) => cb(error)));
    }
  }

  async clearPluginWorkers() {
    const registrations = [...this.pluginWorkers.values()].map(
      (worker) => worker.registration
    );
    for (const registration of registrations) {
      await this.unregisterPluginWorkers(
        registration.orgId,
        registration.pluginId
      );
    }
  }

  async removeOrphanPluginWorkers(configDir: string) {
    await this.withPm2(async (pm2) => {
      const processes = await promisifyPm2<Pm2ProcessDescription[]>((cb) =>
        pm2.list(cb)
      );
      for (const process of processes) {
        if (
          process.name?.startsWith("plugin-") &&
          process.pm2_env?.NAKAMA_PLUGIN_WORKER_ROOT === configDir &&
          !this.pluginWorkers.has(process.name)
        ) {
          await this.deletePluginProcess(pm2, process.name);
        }
      }
    });
  }

  async pausePluginWorkers(): Promise<string[]> {
    this.pluginWorkersPaused = true;
    const running: string[] = [];
    if (!this.pluginWorkers.size) {
      return running;
    }
    try {
      await this.withPm2(async (pm2) => {
        const processes = await promisifyPm2<Pm2ProcessDescription[]>((cb) =>
          pm2.list(cb)
        );
        for (const [name] of this.pluginWorkers) {
          const process = processes.find((item) => item.name === name);
          if (process && process.pm2_env?.status !== "stopped") {
            const shouldResume = process.pm2_env?.status !== "errored";
            await promisifyPm2<void>((cb) =>
              pm2.stop(name, (error) => cb(error))
            );
            if (shouldResume) {
              running.push(name);
            }
          }
        }
      });
      return running;
    } catch (error) {
      await this.resumePluginWorkers(running);
      throw error;
    }
  }

  async resumePluginWorkers(names: string[]): Promise<void> {
    this.pluginWorkersPaused = false;
    for (const name of names) {
      if (this.pluginWorkers.has(name)) {
        await this.startWorker(name);
      }
    }
  }

  isPluginWorkerForOrg(name: string, orgId: string): boolean {
    return this.pluginWorkers.get(name)?.registration.orgId === orgId;
  }

  async unregisterPluginWorkers(
    orgId: string,
    pluginId: string
  ): Promise<void> {
    const entries = [...this.pluginWorkers].filter(
      ([, worker]) =>
        worker.registration.orgId === orgId &&
        worker.registration.pluginId === pluginId
    );
    for (const [name, worker] of entries) {
      // Remove admission before awaiting PM2 so a concurrent Start cannot resurrect it.
      this.pluginWorkers.delete(name);
      try {
        await this.withPm2((pm2) => this.deletePluginProcess(pm2, name));
      } catch (error) {
        this.pluginWorkers.set(name, worker);
        throw error;
      }
    }
  }

  async listPluginWorkers(orgId: string) {
    const statuses = await this.getAllWorkerStatuses();
    return [...this.pluginWorkers]
      .filter(([, worker]) => worker.registration.orgId === orgId)
      .map(([name, worker]) => ({
        label: worker.contribution.name,
        name,
        pluginId: worker.registration.pluginId,
        process: statuses[name]!,
      }));
  }

  private async writePluginWorkerDesired(
    worker: RegisteredPluginWorker,
    desired: boolean
  ) {
    const path = join(worker.directory, "desired.json");
    await writeFile(path + ".tmp", JSON.stringify(desired), { mode: 0o600 });
    await rename(path + ".tmp", path);
  }

  private async startPluginWorker(
    name: string,
    worker: RegisteredPluginWorker
  ) {
    await this.withPm2(async (pm2) => {
      if (this.pluginWorkersPaused || this.pluginWorkers.get(name) !== worker) {
        throw new Error("Plugin worker is disabled");
      }
      const env = {
        ...this.workerProcessEnv(),
        NAKAMA_ORG_ID: worker.registration.orgId,
        NAKAMA_PLUGIN_DATA_DIR: worker.registration.dataDir,
        NAKAMA_PLUGIN_ID: worker.registration.pluginId,
        NAKAMA_PLUGIN_VERSION: worker.registration.version,
        NAKAMA_PLUGIN_WORKER_ROOT: worker.registration.configDir ?? "",
        NAKAMA_WORKER_DATA_DIR: worker.directory,
      };
      if (
        worker.registration.pluginId === "supermemory" &&
        worker.contribution.key === "server"
      ) {
        const path = join(worker.directory, "auto-provider.json");
        await writeFile(
          path + ".tmp",
          JSON.stringify(this.getWorkerLlm?.("openai") ?? null),
          { mode: 0o600 }
        );
        await rename(path + ".tmp", path);
      }
      if (worker.contribution.useHostLlm) {
        const llm = this.getWorkerLlm?.();

        await writeFile(
          join(worker.directory, "llm.json"),
          JSON.stringify(llm ?? null),
          { mode: 0o600 }
        );
      }
      await this.deletePluginProcess(pm2, name);
      await promisifyPm2<void>((cb) =>
        pm2.start(
          {
            args: ["run", worker.script],
            autorestart: true,
            cwd: worker.registration.dataDir,
            env,
            error: join(worker.directory, "stderr.log"),
            exp_backoff_restart_delay: 1000,
            interpreter: "none",
            kill_timeout: 10_000,
            max_restarts: 5,
            min_uptime: 10_000,
            name,
            output: join(worker.directory, "stdout.log"),
            script: process.env.NAKAMA_BUN_BIN ?? "bun",
          },
          (error) => cb(error)
        )
      );
      await this.writePluginWorkerDesired(worker, true);
    });
  }

  isValidWorker(name: string): boolean {
    return VALID_WORKERS.includes(name) || this.pluginWorkers.has(name);
  }

  private resolveWorkerScript(name: string): string {
    const srcScript = WORKER_SCRIPTS[name];
    if (srcScript && existsSync(join(this.projectRoot, srcScript))) {
      return srcScript;
    }

    const distScript = WORKER_DIST_SCRIPTS[name];
    if (distScript && existsSync(join(this.projectRoot, distScript))) {
      return distScript;
    }

    return srcScript!;
  }

  private async removeWorkerFromPm2(
    pm2: NonNullable<typeof import("pm2")>,
    name: string
  ): Promise<void> {
    await promisifyPm2<void>((cb) =>
      pm2.stop(name, (error) => cb(error))
    ).catch(() => {});
    await promisifyPm2<void>((cb) =>
      pm2.delete(name, (error) => cb(error))
    ).catch(() => {});
  }

  async startWorker(name: string): Promise<void> {
    const pluginWorker = this.pluginWorkers.get(name);
    if (pluginWorker) {
      return this.startPluginWorker(name, pluginWorker);
    }
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await setWorkerDesiredRunning(name as PlatformWorkerName, true);

    await this.withPm2(async (pm2) => {
      const script = this.resolveWorkerScript(name);
      await this.removeWorkerFromPm2(pm2, name);
      await promisifyPm2<void>((cb) =>
        pm2.start(
          {
            args: ["run", script],
            cwd: this.projectRoot,
            env: this.workerProcessEnv(),
            name,
            script: "bun",
          },
          (error) => cb(error)
        )
      );
    });
  }

  async stopWorker(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }
    const pluginWorker = this.pluginWorkers.get(name);
    await this.withPm2(async (pm2) => {
      if (
        pluginWorker &&
        (this.pluginWorkersPaused ||
          this.pluginWorkers.get(name) !== pluginWorker)
      ) {
        throw new Error("Plugin worker is disabled");
      }
      await promisifyPm2<void>((cb) => pm2.stop(name, (error) => cb(error)));
      if (pluginWorker) {
        await this.writePluginWorkerDesired(pluginWorker, false);
      }
    });
    if (!pluginWorker) {
      await setWorkerDesiredRunning(name as PlatformWorkerName, false);
    }
  }

  async recoverDesiredWorkers(): Promise<void> {
    const desired = await readWorkerDesiredState();
    const statuses = await this.getAllWorkerStatuses();

    for (const name of VALID_WORKERS) {
      if (!desired[name as PlatformWorkerName]) {
        continue;
      }

      if (statuses[name]?.status === "online") {
        continue;
      }

      try {
        await this.startWorker(name);
        console.log(`Recovered ${name} worker`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Could not recover ${name} worker: ${message}`);
      }
    }
  }

  async restartWorker(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await this.startWorker(name);
  }

  private pm2ProcessToInfo(
    match: Pm2ProcessDescription | undefined
  ): WorkerProcessInfo {
    if (!match) {
      return {
        cpuPercent: null,
        managed: true,
        memoryMb: null,
        status: "stopped",
        uptimeSeconds: null,
      };
    }

    const status = match.pm2_env?.status ?? null;
    const mappedStatus: WorkerProcessInfo["status"] =
      status === "online" || status === "stopped" || status === "errored"
        ? status
        : null;

    return {
      cpuPercent: match.monit?.cpu ?? null,
      managed: true,
      memoryMb:
        match.monit?.memory === undefined
          ? null
          : Math.round((match.monit.memory / 1024 / 1024) * 100) / 100,
      status: mappedStatus,
      uptimeSeconds: match.pm2_env?.pm_uptime
        ? Math.round((Date.now() - match.pm2_env.pm_uptime) / 1000)
        : null,
    };
  }

  private pm2UnavailableInfo(): WorkerProcessInfo {
    return {
      cpuPercent: null,
      managed: false,
      memoryMb: null,
      status: null,
      uptimeSeconds: null,
    };
  }

  async getWorkerStatus(name: string): Promise<WorkerProcessInfo | null> {
    if (!this.isValidWorker(name)) {
      return null;
    }

    try {
      const list = await this.listAllPm2Processes();
      const match = list.find((p) => p.name === name);
      return this.pm2ProcessToInfo(match);
    } catch {
      return this.pm2UnavailableInfo();
    }
  }

  async getAllWorkerStatuses(): Promise<Record<string, WorkerProcessInfo>> {
    try {
      const list = await this.listAllPm2Processes();

      return Object.fromEntries(
        [...VALID_WORKERS, ...this.pluginWorkers.keys()].map((name) => {
          const match = list.find((p) => p.name === name);
          return [name, this.pm2ProcessToInfo(match)];
        })
      );
    } catch {
      return Object.fromEntries(
        [...VALID_WORKERS, ...this.pluginWorkers.keys()].map((name) => [
          name,
          this.pm2UnavailableInfo(),
        ])
      );
    }
  }

  async getWorkerLogs(
    name: string,
    lines: number
  ): Promise<WorkerLogsResponse> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    return this.withPm2(async (pm2) => {
      const descriptions = await promisifyPm2<Pm2ProcessDescription[]>((cb) =>
        pm2.describe(name, cb)
      );
      const desc = descriptions[0];
      const outPath = desc?.pm2_env?.pm_out_log_path as string | undefined;
      const errPath = desc?.pm2_env?.pm_err_log_path as string | undefined;

      const [stdout, stderr] = await Promise.all([
        outPath ? readLastLines(outPath, lines) : "",
        errPath ? readLastLines(errPath, lines) : "",
      ]);

      return { stderr, stdout };
    });
  }

  async clearWorkerLogs(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await this.withPm2(async (pm2) => {
      await promisifyPm2<void>((cb) => pm2.flush(name, (error) => cb(error)));
    });
  }

  private async listAllPm2Processes(): Promise<Pm2ProcessDescription[]> {
    return this.withPm2(async (pm2) =>
      promisifyPm2<Pm2ProcessDescription[]>((cb) => pm2.list(cb))
    );
  }

  private workerProcessEnv(): Record<string, string> {
    const env: Record<string, string> = {
      NODE_ENV: process.env.NODE_ENV ?? "development",
    };

    const serverUrl =
      process.env.NAKAMA_SERVER_URL?.trim() || readRuntimeServerUrl() || "";

    if (serverUrl) {
      env.NAKAMA_SERVER_URL = serverUrl;
    }

    const configDir = process.env.NAKAMA_CONFIG_DIR?.trim();
    if (configDir) {
      env.NAKAMA_CONFIG_DIR = configDir;
    }

    return env;
  }
}

async function readLastLines(path: string, lineCount: number): Promise<string> {
  try {
    const content = await readFile(path, "utf8");
    const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
    const allLines = trimmed.split("\n");
    const lastLines = allLines.slice(-lineCount);
    return lastLines.join("\n");
  } catch {
    return "";
  }
}

interface Pm2ProcessDescription {
  monit?: { cpu?: number; memory?: number };
  name?: string;
  pid?: number;
  pm_id?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
    NAKAMA_PLUGIN_VERSION?: string;
    NAKAMA_PLUGIN_WORKER_ROOT?: string;
  };
}
