import type { WorkerProcessInfo } from "@tinyclaw/core";

const WORKER_SCRIPTS: Record<string, string> = {
  telegram: "apps/platform/telegram/src/index.ts",
  whatsapp: "apps/platform/whatsapp/src/index.ts",
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
  constructor(
    private readonly projectRoot: string,
    private readonly pm2: typeof import("pm2") | null = null,
  ) {}

  private async withPm2<T>(
    action: (pm2: NonNullable<typeof import("pm2")>) => Promise<T>,
  ): Promise<T> {
    if (!this.pm2) {
      throw new Error("PM2 is not available");
    }

    await promisifyPm2<void>((cb) => this.pm2!.connect(cb));

    try {
      return await action(this.pm2);
    } finally {
      this.pm2.disconnect();
    }
  }

  isValidWorker(name: string): boolean {
    return VALID_WORKERS.includes(name);
  }

  async startWorker(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await this.withPm2(async (pm2) => {
      const script = WORKER_SCRIPTS[name]!;
      await promisifyPm2<void>((cb) =>
        pm2.start(
          {
            script: "bun",
            args: ["run", script],
            name,
            cwd: this.projectRoot,
            interpreter: "bun",
            env: {
              NODE_ENV: process.env.NODE_ENV ?? "development",
            },
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
  }

  async restartWorker(name: string): Promise<void> {
    if (!this.isValidWorker(name)) {
      throw new Error(`Unknown worker: ${name}`);
    }

    await this.withPm2(async (pm2) => {
      await promisifyPm2<void>((cb) => pm2.restart(name, cb));
    });
  }

  async getWorkerStatus(name: string): Promise<WorkerProcessInfo | null> {
    if (!this.isValidWorker(name)) {
      return null;
    }

    try {
      const list = await this.listAllPm2Processes();
      const match = list.find((p) => p.name === name);

      if (!match) {
        return { managed: false, status: null, cpuPercent: null, memoryMb: null, uptimeSeconds: null };
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
    } catch {
      return { managed: false, status: null, cpuPercent: null, memoryMb: null, uptimeSeconds: null };
    }
  }

  private async listAllPm2Processes(): Promise<Pm2ProcessDescription[]> {
    return this.withPm2(async (pm2) => {
      return promisifyPm2<Pm2ProcessDescription[]>((cb) => pm2.list(cb));
    });
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
    [key: string]: unknown;
  };
}
