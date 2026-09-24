import { join } from "node:path";
import {
  type ChannelConfigScope,
  getChannelConfigDir,
  isChannelOwner,
} from "./channel-config-shared";
import { readTextOrNull, writeTextFile } from "./fs";
import { getOrgConfigDir, getUserConfigDir } from "./user-config";

export type PlatformWorkerName =
  | "telegram"
  | "whatsapp"
  | "discord"
  | "slack"
  | "automation";

export interface WorkerDesiredState {
  automation: boolean;
  discord: boolean;
  slack: boolean;
  telegram: boolean;
  whatsapp: boolean;
}

const DEFAULT_STATE: WorkerDesiredState = {
  automation: true,
  discord: false,
  slack: false,
  telegram: false,
  whatsapp: false,
};

function getWorkerDesiredStatePath(orgId: string | null = null): string {
  return join(
    orgId ? getOrgConfigDir(orgId) : getUserConfigDir(),
    "runtime",
    "worker-desired-state.json"
  );
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
      slack: record.slack === true,
      telegram: record.telegram === true,
      whatsapp: record.whatsapp === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function readWorkerDesiredState(
  orgId: ChannelConfigScope = null
): Promise<WorkerDesiredState> {
  if (isChannelOwner(orgId)) {
    const state = { ...DEFAULT_STATE, automation: false };
    for (const platform of [
      "telegram",
      "discord",
      "whatsapp",
      "slack",
    ] as const) {
      state[platform] =
        (
          await readTextOrNull(
            join(getChannelConfigDir(platform, orgId), "desired.json")
          )
        )?.trim() === "true";
    }
    return state;
  }
  const raw = await readTextOrNull(getWorkerDesiredStatePath(orgId));

  if (raw === null) {
    return { ...DEFAULT_STATE };
  }

  return parseWorkerDesiredState(raw.trim());
}

export async function setWorkerDesiredRunning(
  name: PlatformWorkerName,
  running: boolean,
  orgId: ChannelConfigScope = null
): Promise<void> {
  if (isChannelOwner(orgId)) {
    if (name === "automation") {
      throw new Error("Automation has no channel owner");
    }
    await writeTextFile(
      join(getChannelConfigDir(name, orgId), "desired.json"),
      JSON.stringify(running)
    );
    return;
  }
  const state = await readWorkerDesiredState(orgId);
  state[name] = running;

  await writeTextFile(
    getWorkerDesiredStatePath(orgId),
    `${JSON.stringify(state)}\n`
  );
}
