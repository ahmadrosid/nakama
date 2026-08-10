import { join } from "node:path";
import {
  pathExists,
  readTextOrNull,
  removeFile,
  writePrivateTextFile,
} from "./fs";
import { getUserConfigDir } from "./user-config";

export interface AutomationWorkerHeartbeat {
  pid: number;
  running: boolean;
  scheduledJobs: number;
  updatedAt: string;
}

export interface AutomationWorkerHeartbeatStatus {
  pid: number | null;
  running: boolean;
  scheduledJobs: number;
}

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 45_000;
const HEARTBEAT_FILENAME = "worker-heartbeat.json";
const AUTOMATION_CONFIG_DIR_NAME = "automation";

export function getAutomationConfigDir(): string {
  return join(getUserConfigDir(), AUTOMATION_CONFIG_DIR_NAME);
}

export function getAutomationWorkerHeartbeatPath(): string {
  return join(getAutomationConfigDir(), HEARTBEAT_FILENAME);
}

export function isAutomationProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isAutomationHeartbeatAlive(
  heartbeat: AutomationWorkerHeartbeat | null,
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS
): boolean {
  if (!heartbeat) {
    return false;
  }

  const updatedAt = Date.parse(heartbeat.updatedAt);

  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  if (Date.now() - updatedAt > maxAgeMs) {
    return false;
  }

  return isAutomationProcessAlive(heartbeat.pid) && heartbeat.running;
}

export function parseAutomationWorkerHeartbeat(
  raw: string
): AutomationWorkerHeartbeat | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as AutomationWorkerHeartbeat).pid !== "number" ||
      typeof (parsed as AutomationWorkerHeartbeat).updatedAt !== "string" ||
      typeof (parsed as AutomationWorkerHeartbeat).running !== "boolean" ||
      typeof (parsed as AutomationWorkerHeartbeat).scheduledJobs !== "number"
    ) {
      return null;
    }

    return parsed as AutomationWorkerHeartbeat;
  } catch {
    return null;
  }
}

export async function writeAutomationWorkerHeartbeat(
  running: boolean,
  scheduledJobs: number,
  pid = process.pid,
  updatedAt = new Date().toISOString()
): Promise<void> {
  const payload: AutomationWorkerHeartbeat = {
    pid,
    running,
    scheduledJobs,
    updatedAt,
  };

  await writePrivateTextFile(
    getAutomationWorkerHeartbeatPath(),
    `${JSON.stringify(payload)}\n`,
    { ensureDir: getAutomationConfigDir() }
  );
}

export async function clearAutomationWorkerHeartbeat(): Promise<void> {
  const path = getAutomationWorkerHeartbeatPath();

  if (await pathExists(path)) {
    await removeFile(path);
  }
}

export async function readAutomationWorkerHeartbeat(): Promise<AutomationWorkerHeartbeat | null> {
  const raw = await readTextOrNull(getAutomationWorkerHeartbeatPath());

  if (raw === null) {
    return null;
  }

  return parseAutomationWorkerHeartbeat(raw.trim());
}

export async function isAutomationWorkerRunning(
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS
): Promise<boolean> {
  return isAutomationHeartbeatAlive(
    await readAutomationWorkerHeartbeat(),
    maxAgeMs
  );
}

export async function getAutomationWorkerHeartbeatStatus(
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS
): Promise<AutomationWorkerHeartbeatStatus> {
  const heartbeat = await readAutomationWorkerHeartbeat();
  const running = isAutomationHeartbeatAlive(heartbeat, maxAgeMs);

  return {
    pid: heartbeat?.pid ?? null,
    running,
    scheduledJobs: running ? (heartbeat?.scheduledJobs ?? 0) : 0,
  };
}
