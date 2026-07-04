import type {
  DatabaseAdapter,
  StoredCodingAgentHarnessKind,
  StoredCodingAgentHarnessRecord,
} from "@tinyclaw/db";
import { WORKSPACE_SETTINGS_ID } from "@tinyclaw/db";

export interface CodingAgentHarnessStatus extends StoredCodingAgentHarnessRecord {
  installed: boolean;
}

export interface CodingAgentWorkspaceSettings {
  harnesses: StoredCodingAgentHarnessRecord[];
  selectedHarnessId: string | null;
}

const DEFAULT_HARNESSES: StoredCodingAgentHarnessRecord[] = [
  {
    id: "coding-harness-codex",
    kind: "codex",
    name: "Codex",
    command: "codex",
    args: [],
    enabled: true,
  },
  {
    id: "coding-harness-claude-code",
    kind: "claude_code",
    name: "Claude Code",
    command: "claude",
    args: [],
    enabled: true,
  },
  {
    id: "coding-harness-opencode",
    kind: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: [],
    enabled: true,
  },
];

export async function loadCodingAgentWorkspaceSettings(
  db: DatabaseAdapter,
): Promise<CodingAgentWorkspaceSettings> {
  const stored = await db.getWorkspaceSettings();

  return {
    harnesses: mergeHarnesses(stored?.codingAgentHarnesses ?? []),
    selectedHarnessId: stored?.selectedCodingAgentHarness ?? null,
  };
}

export async function listCodingAgentHarnessStatuses(
  db: DatabaseAdapter,
): Promise<CodingAgentHarnessStatus[]> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  return Promise.all(
    settings.harnesses.map(async (harness) => ({
      ...harness,
      installed: await isCommandAvailable(harness.command),
    })),
  );
}

export async function saveCodingAgentWorkspaceSettings(
  db: DatabaseAdapter,
  input: {
    selectedHarnessId?: string | null;
    harnesses?: Array<{
      id: string;
      command?: string;
      enabled?: boolean;
    }>;
  },
): Promise<CodingAgentWorkspaceSettings> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const byId = new Map(settings.harnesses.map((harness) => [harness.id, harness]));

  const nextHarnesses = settings.harnesses.map((harness) => {
    const override = input.harnesses?.find((entry) => entry.id === harness.id);

    if (!override) {
      return harness;
    }

    return {
      ...harness,
      command: override.command?.trim() ? override.command.trim() : harness.command,
      enabled: override.enabled ?? harness.enabled,
    };
  });

  const selectedHarnessId =
    input.selectedHarnessId === undefined
      ? settings.selectedHarnessId
      : input.selectedHarnessId && byId.has(input.selectedHarnessId)
        ? input.selectedHarnessId
        : null;

  await db.upsertWorkspaceSettings({
    id: stored?.id ?? WORKSPACE_SETTINGS_ID,
    visionModel: stored?.visionModel ?? null,
    transcriptionModel: stored?.transcriptionModel ?? null,
    codingAgentHarnesses: nextHarnesses,
    selectedCodingAgentHarness: selectedHarnessId,
    updatedAt: new Date().toISOString(),
  });

  return {
    harnesses: nextHarnesses,
    selectedHarnessId,
  };
}

export async function resolveCodingAgentHarness(
  db: DatabaseAdapter,
  preferredKind?: StoredCodingAgentHarnessKind | null,
): Promise<CodingAgentHarnessStatus> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const statuses = await Promise.all(
    settings.harnesses.map(async (harness) => ({
      ...harness,
      installed: await isCommandAvailable(harness.command),
    })),
  );

  const enabled = statuses.filter((harness) => harness.enabled);

  if (preferredKind) {
    const preferred = enabled.find((harness) => harness.kind === preferredKind);

    if (!preferred) {
      throw new Error(`Configured coding agent '${preferredKind}' is unavailable.`);
    }

    if (!preferred.installed) {
      throw new Error(`${preferred.name} is selected but not installed.`);
    }

    return preferred;
  }

  if (settings.selectedHarnessId) {
    const selected = enabled.find((harness) => harness.id === settings.selectedHarnessId);

    if (selected?.installed) {
      return selected;
    }
  }

  const firstInstalled = enabled.find((harness) => harness.installed);

  if (firstInstalled) {
    return firstInstalled;
  }

  throw new Error(
    "No supported coding agent is installed. Install Codex, Claude Code, or OpenCode first.",
  );
}

function mergeHarnesses(
  storedHarnesses: StoredCodingAgentHarnessRecord[],
): StoredCodingAgentHarnessRecord[] {
  const byKind = new Map<StoredCodingAgentHarnessKind, StoredCodingAgentHarnessRecord>();

  for (const harness of storedHarnesses) {
    byKind.set(harness.kind, harness);
  }

  return DEFAULT_HARNESSES.map((defaultHarness) => {
    const stored = byKind.get(defaultHarness.kind);

    return stored
      ? {
          ...stored,
          name: stored.name || defaultHarness.name,
          command: stored.command || defaultHarness.command,
          args: stored.args.length > 0 ? stored.args : defaultHarness.args,
        }
      : { ...defaultHarness, args: [...defaultHarness.args] };
  });
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"],
    });

    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}
