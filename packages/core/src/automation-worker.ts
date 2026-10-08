import { join } from "node:path";
import { z } from "zod";
import { getUserConfigDir } from "./user-config";
import {
  createWorkerHeartbeatStore,
  type WorkerHeartbeatBase,
} from "./worker-heartbeat";

export interface AutomationWorkerHeartbeat extends WorkerHeartbeatBase {
  running: boolean;
  scheduledJobs: number;
}

export interface AutomationWorkerHeartbeatStatus {
  pid: number | null;
  running: boolean;
  scheduledJobs: number;
}

const AUTOMATION_CONFIG_DIR_NAME = "automation";

export function getAutomationConfigDir(): string {
  return join(getUserConfigDir(), AUTOMATION_CONFIG_DIR_NAME);
}

const store = createWorkerHeartbeatStore<AutomationWorkerHeartbeat>({
  getDir: getAutomationConfigDir,
  isAliveExtra: (heartbeat) => heartbeat.running,
  parse: (value, base) => {
    const parsed = z.object({
      running: z.boolean(),
      scheduledJobs: z.number(),
    }).safeParse(value);

    if (!parsed.success) {
      return null;
    }

    return {
      ...base,
      running: parsed.data.running,
      scheduledJobs: parsed.data.scheduledJobs,
    };
  },
});

export const parseAutomationWorkerHeartbeat = store.parse;

export const readAutomationWorkerHeartbeat = store.read;

export const clearAutomationWorkerHeartbeat = store.clear;

export const isAutomationWorkerRunning = store.isRunning;

export const isAutomationHeartbeatAlive = store.isAlive;

export async function writeAutomationWorkerHeartbeat(
  running: boolean,
  scheduledJobs: number,
  pid = process.pid,
  updatedAt = new Date().toISOString()
): Promise<void> {
  await store.write({ pid, running, scheduledJobs, updatedAt });
}

export async function getAutomationWorkerHeartbeatStatus(
  maxAgeMs?: number
): Promise<AutomationWorkerHeartbeatStatus> {
  const heartbeat = await readAutomationWorkerHeartbeat();
  const running = isAutomationHeartbeatAlive(heartbeat, maxAgeMs);

  return {
    pid: heartbeat?.pid ?? null,
    running,
    scheduledJobs: running ? (heartbeat?.scheduledJobs ?? 0) : 0,
  };
}
