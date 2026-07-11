import { join } from "node:path";
import { readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

export type PlatformWorkerName = "telegram" | "whatsapp" | "discord" | "automation";

export interface WorkerDesiredState {
  telegram: boolean;
  whatsapp: boolean;
  discord: boolean;
  automation: boolean;
}

const DEFAULT_STATE: WorkerDesiredState = {
  telegram: false,
  whatsapp: false,
  discord: false,
  automation: true,
};

function getWorkerDesiredStatePath(): string {
  return join(getUserConfigDir(), "runtime", "worker-desired-state.json");
}

export function parseWorkerDesiredState(raw: string): WorkerDesiredState {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_STATE };
    }

    const record = parsed as Partial<WorkerDesiredState>;

    return {
      telegram: record.telegram === true,
      whatsapp: record.whatsapp === true,
      discord: record.discord === true,
      automation: record.automation === undefined ? true : record.automation === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function readWorkerDesiredState(): Promise<WorkerDesiredState> {
  const raw = await readTextOrNull(getWorkerDesiredStatePath());

  if (raw === null) {
    return { ...DEFAULT_STATE };
  }

  return parseWorkerDesiredState(raw.trim());
}

export async function setWorkerDesiredRunning(
  name: PlatformWorkerName,
  running: boolean,
): Promise<void> {
  const state = await readWorkerDesiredState();
  state[name] = running;

  await writePrivateTextFile(
    getWorkerDesiredStatePath(),
    `${JSON.stringify(state)}\n`,
    { ensureDir: join(getUserConfigDir(), "runtime") },
  );
}
