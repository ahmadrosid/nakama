import { join } from "node:path";
import { readTextOrNull, writeTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

export type PlatformWorkerName =
  | "telegram"
  | "whatsapp"
  | "discord"
  | "automation";

export interface WorkerDesiredState {
  automation: boolean;
  discord: boolean;
  telegram: boolean;
  whatsapp: boolean;
}

const DEFAULT_STATE: WorkerDesiredState = {
  automation: true,
  discord: false,
  telegram: false,
  whatsapp: false,
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
      automation:
        record.automation === undefined ? true : record.automation === true,
      discord: record.discord === true,
      telegram: record.telegram === true,
      whatsapp: record.whatsapp === true,
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
  running: boolean
): Promise<void> {
  const state = await readWorkerDesiredState();
  state[name] = running;

  await writeTextFile(
    getWorkerDesiredStatePath(),
    `${JSON.stringify(state)}\n`,
    { ensureDir: join(getUserConfigDir(), "runtime") }
  );
}
