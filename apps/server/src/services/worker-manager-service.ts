import type { WorkerLogsResponse, WorkerProcessInfo } from "@nakama/core";
import {
  readWorkerDesiredState,
  readRuntimeServerUrl,
  setWorkerDesiredRunning,
  type PlatformWorkerName,
} from "@nakama/core";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WORKER_SCRIPTS: Record<string, string> = {
  telegram: "apps/platform/telegram/src/index.ts",
  whatsapp: "apps/platform/whatsapp/src/index.ts",
  discord: "apps/platform/discord/src/index.ts",
  automation: "apps/platform/automation/src/index.ts",
};

const WORKER_DIST_SCRIPTS: Partial<Record<string, string>> = {
  telegram: "apps/platform/telegram/dist/index.js",
  whatsapp: "apps/platform/whatsapp/dist/index.js",
  discord: "apps/platform/discord/dist/index.js",
  automation: "apps/platform/automation/dist/index.js",
};

const VALID_WORKERS = Object.keys(WORKER_SCRIPTS);

function promisifyPm2<T>(
  fn: (cb: (err: Error | null, result?: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

export class WorkerManagerService {
  private pm2Module: typeof import("pm2") | null = null;

  constructor(
    private readonly projectRoot: string,
    pm2?: typeof import("pm2"),
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
      throw new Error("PM2 is not available. Install it with: npm install -g pm2");
    }
  }

  private async withPm2<T>(
    action: (pm2: NonNullable<typeof import("pm2")>) => Promise<T>,
  ): Promise<T> {
    const pm2 = await this.ensurePm2();

    await promisifyPm2<void>((cb) => pm2.connect(cb));

    try {
      return await action(pm2);
    } finally {
      pm2.disconnect();
    }
  }

  isValidWorker(name: string): boolean {
    return VALID_WORKERS.includes(name);
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
    name: string,
  ): Promise<void> {
    await promisifyPm2<void>((cb) => pm2.stop(name, cb)).catch(() => {});
    await promisifyPm2<void>((cb) => pm2.delete(name, cb)).catch(() => {});
  }

  async startWorker(name: string): Promise<void> {
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
            script: "bun",
            args: ["run", script],
            name,
            cwd: this.projectRoot,
            env: this.workerProcessEnv(),
          },
          cb,
        ),
      );
    });
  }

  async stopWorker(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await this.withPm2(async (pm2) => {
      await promisifyPm2<void>((cb) => pm2.stop(name, cb));
    });

    await setWorkerDesiredRunning(name as PlatformWorkerName, false);
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
    match: Pm2ProcessDescription | undefined,
  ): WorkerProcessInfo {
    if (!match) {
      return { managed: true, status: "stopped", cpuPercent: null, memoryMb: null, uptimeSeconds: null };
    }

    const status = match.pm2_env?.status ?? null;
    const mappedStatus: WorkerProcessInfo["status"] =
      status === "online" || status === "stopped" || status === "errored"
        ? status
        : null;

    return {
      managed: true,
      status: mappedStatus,
      cpuPercent: match.monit?.cpu ?? null,
      memoryMb: match.monit ? Math.round(match.monit.memory / 1024 / 1024 * 100) / 100 : null,
      uptimeSeconds: match.pm2_env?.pm_uptime
        ? Math.round((Date.now() - match.pm2_env.pm_uptime) / 1000)
        : null,
    };
  }

  private pm2UnavailableInfo(): WorkerProcessInfo {
    return { managed: false, status: null, cpuPercent: null, memoryMb: null, uptimeSeconds: null };
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
        VALID_WORKERS.map((name) => {
          const match = list.find((p) => p.name === name);
          return [name, this.pm2ProcessToInfo(match)];
        }),
      );
    } catch {
      return Object.fromEntries(
        VALID_WORKERS.map((name) => [name, this.pm2UnavailableInfo()]),
      );
    }
  }

  async getWorkerLogs(name: string, lines: number): Promise<WorkerLogsResponse> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    return this.withPm2(async (pm2) => {
      const descriptions = await promisifyPm2<Pm2ProcessDescription[]>((cb) =>
        pm2.describe(name, cb),
      );
      const desc = descriptions[0];
      const outPath = desc?.pm2_env?.pm_out_log_path as string | undefined;
      const errPath = desc?.pm2_env?.pm_err_log_path as string | undefined;

      const [stdout, stderr] = await Promise.all([
        outPath ? readLastLines(outPath, lines) : "",
        errPath ? readLastLines(errPath, lines) : "",
      ]);

      return { stdout, stderr };
    });
  }

  async clearWorkerLogs(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await this.withPm2(async (pm2) => {
      await promisifyPm2<void>((cb) => pm2.flush(name, cb));
    });
  }

  private async listAllPm2Processes(): Promise<Pm2ProcessDescription[]> {
    return this.withPm2(async (pm2) => {
      return promisifyPm2<Pm2ProcessDescription[]>((cb) => pm2.list(cb));
    });
  }

  private workerProcessEnv(): Record<string, string> {
    const env: Record<string, string> = {
      NODE_ENV: process.env.NODE_ENV ?? "development",
    };

    const serverUrl =
      process.env.nakama_SERVER_URL?.trim() || readRuntimeServerUrl() || "";

    if (serverUrl) {
      env.nakama_SERVER_URL = serverUrl;
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
  name?: string;
  pid?: number;
  pm_id?: number;
  monit?: { cpu: number; memory: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
    [key: string]: unknown;
  };
}
