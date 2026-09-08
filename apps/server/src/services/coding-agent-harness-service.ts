import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { UserConfig } from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredCodingAgentHarnessKind,
  StoredCodingAgentHarnessProbeCache,
  StoredCodingAgentHarnessRecord,
} from "@nakama/db";
import {
  isCodingAgentProviderPassthroughEnabled,
  mergeWorkspaceSettings,
} from "@nakama/db";
import {
  ensureProcessPath,
  getToolExecutionEnv,
} from "../lib/ensure-process-path";
import {
  buildGlobalPackageInstallPlan,
  CLI_SIGTERM_GRACE_MS,
  detectNpmOrBun,
  probeCliVersion,
} from "./cli-package-install";
import { buildHarnessNonInteractiveArgs } from "./coding-agent-command";
import {
  formatModelForHarness,
  mapNakamaProviderToPi,
  mergeCodingAgentSpawnEnv,
  resolveCodingAgentSpawnBundle,
} from "./coding-agent-spawn-env";

/** How long a timed-out child gets to honour SIGTERM before it is killed. */
const SIGTERM_GRACE_MS = CLI_SIGTERM_GRACE_MS;

export interface CodingAgentHarnessStatus
  extends StoredCodingAgentHarnessRecord {
  authenticated: boolean | null;
  installed: boolean;
  nextStep: "install" | "retry" | null;
  ready: boolean;
  statusMessage: string | null;
  version: string | null;
}

const HARNESS_PACKAGES: Partial<Record<StoredCodingAgentHarnessKind, string>> =
  {
    claude_code: "@anthropic-ai/claude-code",
    codex: "@openai/codex",
    opencode: "opencode-ai",
    pi: "@earendil-works/pi-coding-agent",
  };

export function buildCodingHarnessInstallPlan(
  kind: StoredCodingAgentHarnessKind,
  packageManager: "npm" | "bun" = detectNpmOrBun()
) {
  const pkg = HARNESS_PACKAGES[kind];

  if (!pkg) {
    throw new Error(
      kind === "cursor_agent"
        ? "Cursor Agent CLI cannot be auto-installed. Install and authenticate it on the host yourself (verify with `agent --version`)."
        : `No auto-install package is configured for coding harness kind ${kind}.`
    );
  }

  return buildGlobalPackageInstallPlan(pkg, packageManager);
}

export interface CodingAgentWorkspaceSettings {
  harnesses: StoredCodingAgentHarnessRecord[];
  providerPassthroughEnabled: boolean;
  selectedHarnessId: string | null;
}

const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

export interface CodingAgentHarnessProbeContext {
  probeTimeoutMs?: number;
  profileModel?: string | null;
  providerPassthroughEnabled?: boolean;
  userConfig?: UserConfig | null;
}

export interface ListCodingAgentHarnessStatusesOptions {
  /** When set with probe, only probe this harness id. */
  harnessId?: string | null;
  /** When true, run live readiness probes for installed harnesses. Default false (use cache). */
  probe?: boolean;
  probeContext?: CodingAgentHarnessProbeContext;
}

const DEFAULT_HARNESSES: StoredCodingAgentHarnessRecord[] = [
  {
    args: [],
    command: "codex",
    enabled: true,
    id: "coding-harness-codex",
    kind: "codex",
    name: "Codex",
  },
  {
    args: [],
    command: "claude",
    enabled: true,
    id: "coding-harness-claude-code",
    kind: "claude_code",
    name: "Claude Code",
  },
  {
    args: [],
    command: "opencode",
    enabled: true,
    id: "coding-harness-opencode",
    kind: "opencode",
    name: "OpenCode",
  },
  {
    args: [],
    command: "pi",
    enabled: true,
    id: "coding-harness-pi",
    kind: "pi",
    name: "pi.dev",
  },
  {
    args: [],
    command: "agent",
    enabled: true,
    id: "coding-harness-cursor-agent",
    kind: "cursor_agent",
    name: "Cursor Agent",
  },
];

export async function loadCodingAgentWorkspaceSettings(
  db: DatabaseAdapter
): Promise<CodingAgentWorkspaceSettings> {
  const stored = await db.getWorkspaceSettings();

  return {
    harnesses: mergeHarnesses(stored?.codingAgentHarnesses ?? []),
    providerPassthroughEnabled: isCodingAgentProviderPassthroughEnabled(
      stored ?? null
    ),
    selectedHarnessId: stored?.selectedCodingAgentHarness ?? null,
  };
}

export async function listCodingAgentHarnessStatuses(
  db: DatabaseAdapter,
  options: ListCodingAgentHarnessStatusesOptions = {}
): Promise<CodingAgentHarnessStatus[]> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const probe = options.probe ?? false;
  const probeHarnessId = options.harnessId ?? null;

  return Promise.all(
    settings.harnesses.map(async (harness) => {
      const runtime = await getHarnessRuntimeStatus(harness.command);

      if (!runtime.installed) {
        return {
          ...harness,
          ...runtime,
          authenticated: null,
          nextStep: "install" as const,
          ready: false,
          statusMessage: `${harness.name} is not installed on this machine yet.`,
        };
      }

      const probeContext = withPassthroughProbeContext(
        options.probeContext,
        settings.providerPassthroughEnabled
      );

      const shouldProbe =
        probe && (probeHarnessId === null || probeHarnessId === harness.id);

      if (!shouldProbe) {
        if (isProbeCacheFresh(harness.probeCache)) {
          return buildHarnessStatusFromCache(harness, runtime);
        }

        const light = await probeHarnessLight(harness, probeContext);

        return {
          ...harness,
          ...runtime,
          authenticated: light.authenticated,
          nextStep: light.nextStep,
          ready: light.ready,
          statusMessage: light.statusMessage,
        };
      }

      const probed = await probeHarnessExec(
        {
          ...harness,
          ...runtime,
          authenticated: null,
          nextStep: null,
          ready: false,
          statusMessage: null,
        },
        probeContext
      );

      return {
        ...harness,
        ...runtime,
        authenticated: probed.authenticated,
        nextStep: probed.nextStep,
        ready: probed.ready,
        statusMessage: probed.statusMessage,
      };
    })
  );
}

export async function refreshCodingAgentHarnessProbe(
  db: DatabaseAdapter,
  harnessId: string,
  probeContext?: CodingAgentHarnessProbeContext
): Promise<CodingAgentHarnessStatus> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const harness = settings.harnesses.find((entry) => entry.id === harnessId);

  if (!harness) {
    throw new Error("Unknown coding harness.");
  }

  const runtime = await getHarnessRuntimeStatus(harness.command);

  if (!runtime.installed) {
    await clearHarnessProbeCache(db, harnessId);

    return {
      ...harness,
      ...runtime,
      authenticated: null,
      nextStep: "install",
      ready: false,
      statusMessage: `${harness.name} is not installed on this machine yet.`,
    };
  }

  const probe = await probeHarnessExec(
    {
      ...harness,
      ...runtime,
      authenticated: null,
      nextStep: null,
      ready: false,
      statusMessage: null,
    },
    withPassthroughProbeContext(
      probeContext,
      settings.providerPassthroughEnabled
    )
  );

  const checkedAt = new Date().toISOString();
  const probeCache: StoredCodingAgentHarnessProbeCache = {
    authenticated: probe.authenticated,
    checkedAt,
    nextStep: probe.nextStep,
    ready: probe.ready,
    statusMessage: probe.statusMessage,
  };

  await saveHarnessProbeCache(db, harnessId, probeCache);

  return {
    ...harness,
    ...runtime,
    authenticated: probe.authenticated,
    nextStep: probe.nextStep,
    probeCache,
    ready: probe.ready,
    statusMessage: probe.statusMessage,
  };
}

export async function saveCodingAgentWorkspaceSettings(
  db: DatabaseAdapter,
  input: {
    selectedHarnessId?: string | null;
    providerPassthroughEnabled?: boolean;
    harnesses?: Array<{
      id: string;
      command?: string;
      enabled?: boolean;
    }>;
  }
): Promise<CodingAgentWorkspaceSettings> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const byId = new Map(
    settings.harnesses.map((harness) => [harness.id, harness])
  );

  const nextHarnesses = settings.harnesses.map((harness) => {
    const override = input.harnesses?.find((entry) => entry.id === harness.id);

    if (!override) {
      return harness;
    }

    return {
      ...harness,
      command: override.command?.trim()
        ? override.command.trim()
        : harness.command,
      enabled: override.enabled ?? harness.enabled,
    };
  });

  const selectedHarnessId =
    input.selectedHarnessId === undefined
      ? settings.selectedHarnessId
      : input.selectedHarnessId && byId.has(input.selectedHarnessId)
        ? input.selectedHarnessId
        : null;
  const providerPassthroughEnabled =
    input.providerPassthroughEnabled ?? settings.providerPassthroughEnabled;

  await db.upsertWorkspaceSettings(
    mergeWorkspaceSettings(stored, {
      codingAgentHarnesses: nextHarnesses,
      codingAgentProviderPassthrough: providerPassthroughEnabled,
      selectedCodingAgentHarness: selectedHarnessId,
      updatedAt: new Date().toISOString(),
    })
  );

  return {
    harnesses: nextHarnesses,
    providerPassthroughEnabled,
    selectedHarnessId,
  };
}

function matchesHarnessBinary(command: string, binary: string): boolean {
  const trimmed = command.trim();
  const harnessBinary = binary.trim();

  if (!harnessBinary) {
    return false;
  }

  return trimmed === harnessBinary || trimmed.startsWith(`${harnessBinary} `);
}

export function isCodingAgentCommand(
  command: string,
  harnesses: Array<Pick<StoredCodingAgentHarnessRecord, "command" | "enabled">>
): boolean {
  for (const harness of harnesses) {
    if (!harness.enabled) {
      continue;
    }

    if (matchesHarnessBinary(command, harness.command)) {
      return true;
    }
  }

  return false;
}

/** First enabled harness whose configured command matches argv0 / prefix. */
export function inferCodingAgentHarnessKind(
  command: string,
  harnesses: Array<
    Pick<StoredCodingAgentHarnessRecord, "kind" | "command" | "enabled">
  >
): StoredCodingAgentHarnessKind | null {
  for (const harness of harnesses) {
    if (!harness.enabled) {
      continue;
    }

    if (matchesHarnessBinary(command, harness.command)) {
      return harness.kind;
    }
  }

  return null;
}

/** Light PATH discovery — installed harnesses without requiring a saved selection. */
export async function listInstalledCodingAgentHarnesses(
  db: DatabaseAdapter
): Promise<CodingAgentHarnessStatus[]> {
  const statuses = await listCodingAgentHarnessStatuses(db);
  return statuses.filter((harness) => harness.enabled && harness.installed);
}

export async function resolveCodingAgentHarness(
  db: DatabaseAdapter,
  preferredKind?: StoredCodingAgentHarnessKind | null,
  probeContext?: CodingAgentHarnessProbeContext
): Promise<CodingAgentHarnessStatus> {
  const statuses = await listCodingAgentHarnessStatuses(db);
  const enabled = statuses.filter((harness) => harness.enabled);

  const notReadyError = (harness: CodingAgentHarnessStatus): Error => {
    if (!harness.installed) {
      return new Error(`${harness.name} is selected but not installed.`);
    }

    const message = harness.statusMessage ?? `${harness.name} is not ready.`;

    return new Error(message);
  };

  const ensureReady = async (
    harness: CodingAgentHarnessStatus
  ): Promise<CodingAgentHarnessStatus> => {
    if (harness.ready && isProbeCacheFresh(harness.probeCache)) {
      return harness;
    }

    const refreshed = await refreshCodingAgentHarnessProbe(
      db,
      harness.id,
      probeContext
    );

    if (refreshed.ready) {
      return refreshed;
    }

    throw notReadyError(refreshed);
  };

  if (preferredKind) {
    const preferred = enabled.find((harness) => harness.kind === preferredKind);

    if (!preferred) {
      throw new Error(
        `Configured coding agent '${preferredKind}' is unavailable.`
      );
    }

    return ensureReady(preferred);
  }

  const installed = enabled.filter((harness) => harness.installed);
  const [firstInstalled, secondInstalled] = installed;

  if (firstInstalled && !secondInstalled) {
    return ensureReady(firstInstalled);
  }

  if (secondInstalled) {
    throw new Error(
      "Multiple coding agents are installed. Ask the user which one to use, then run that CLI via bash."
    );
  }

  throw new Error(
    "No coding agent CLI is installed on this host. Install one via bash using the skill Prerequisites, then retry."
  );
}

function mergeHarnesses(
  storedHarnesses: StoredCodingAgentHarnessRecord[]
): StoredCodingAgentHarnessRecord[] {
  const byKind = new Map<
    StoredCodingAgentHarnessKind,
    StoredCodingAgentHarnessRecord
  >();

  for (const harness of storedHarnesses) {
    byKind.set(harness.kind, harness);
  }

  return DEFAULT_HARNESSES.map((defaultHarness) => {
    const stored = byKind.get(defaultHarness.kind);

    return stored
      ? {
          ...stored,
          args: stored.args.length > 0 ? stored.args : defaultHarness.args,
          command: stored.command || defaultHarness.command,
          name: stored.name || defaultHarness.name,
        }
      : { ...defaultHarness, args: [...defaultHarness.args] };
  });
}

function isProbeCacheFresh(
  cache: StoredCodingAgentHarnessProbeCache | null | undefined
): boolean {
  if (!cache?.checkedAt) {
    return false;
  }

  const checkedAt = Date.parse(cache.checkedAt);

  if (Number.isNaN(checkedAt)) {
    return false;
  }

  return Date.now() - checkedAt < PROBE_CACHE_TTL_MS;
}

function buildHarnessStatusFromCache(
  harness: StoredCodingAgentHarnessRecord,
  runtime: Pick<CodingAgentHarnessStatus, "installed" | "version">
): CodingAgentHarnessStatus {
  const cache = harness.probeCache;

  if (cache) {
    return {
      ...harness,
      ...runtime,
      authenticated: cache.authenticated,
      nextStep: cache.nextStep,
      ready: cache.ready,
      statusMessage: cache.statusMessage,
    };
  }

  return {
    ...harness,
    ...runtime,
    authenticated: null,
    nextStep: null,
    ready: false,
    statusMessage: null,
  };
}

async function saveHarnessProbeCache(
  db: DatabaseAdapter,
  harnessId: string,
  probeCache: StoredCodingAgentHarnessProbeCache
): Promise<void> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const nextHarnesses = settings.harnesses.map((harness) =>
    harness.id === harnessId ? { ...harness, probeCache } : harness
  );

  await db.upsertWorkspaceSettings(
    mergeWorkspaceSettings(stored, {
      codingAgentHarnesses: nextHarnesses,
      selectedCodingAgentHarness: settings.selectedHarnessId,
      updatedAt: new Date().toISOString(),
    })
  );
}

async function clearHarnessProbeCache(
  db: DatabaseAdapter,
  harnessId: string
): Promise<void> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const nextHarnesses = settings.harnesses.map((harness) =>
    harness.id === harnessId ? { ...harness, probeCache: null } : harness
  );

  await db.upsertWorkspaceSettings(
    mergeWorkspaceSettings(stored, {
      codingAgentHarnesses: nextHarnesses,
      selectedCodingAgentHarness: settings.selectedHarnessId,
      updatedAt: new Date().toISOString(),
    })
  );
}

async function getHarnessRuntimeStatus(
  command: string
): Promise<Pick<CodingAgentHarnessStatus, "installed" | "version">> {
  const initial = await probeCliVersion(command);

  if (initial.installed || !initial.missing) {
    return {
      installed: initial.installed,
      version: initial.version,
    };
  }

  ensureProcessPath();
  const retried = await probeCliVersion(command);

  return {
    installed: retried.installed,
    version: retried.version,
  };
}

export function getCodingHarnessLoginCommand(
  kind: StoredCodingAgentHarnessKind
): string | null {
  if (kind === "codex") {
    return "codex login";
  }

  if (kind === "claude_code") {
    return "claude auth login";
  }

  if (kind === "opencode") {
    return "opencode auth login";
  }

  if (kind === "pi") {
    return "pi login";
  }

  return null;
}

export function listCodingHarnessLoginCommands(): Array<{
  command: string;
  name: string;
}> {
  return DEFAULT_HARNESSES.flatMap((harness) => {
    const command = getCodingHarnessLoginCommand(harness.kind);
    return command ? [{ command, name: harness.name }] : [];
  });
}

function withPassthroughProbeContext(
  probeContext: CodingAgentHarnessProbeContext | undefined,
  providerPassthroughEnabled: boolean
): CodingAgentHarnessProbeContext {
  return {
    ...probeContext,
    providerPassthroughEnabled:
      probeContext?.providerPassthroughEnabled ?? providerPassthroughEnabled,
  };
}

function harnessNativeLoginMessage(
  harness: Pick<CodingAgentHarnessStatus, "kind" | "name">
): string {
  const login = getCodingHarnessLoginCommand(harness.kind);

  if (login) {
    return `${harness.name} is installed. Uses harness login on this server (\`${login}\`).`;
  }

  return `${harness.name} is installed. Uses host Cursor auth (no Nakama provider passthrough).`;
}

export function getCodingHarnessInstallCommand(
  kind: StoredCodingAgentHarnessKind
): string {
  return buildCodingHarnessInstallPlan(kind).displayCommand;
}

async function probeHarnessLight(
  harness: CodingAgentHarnessStatus,
  probeContext?: CodingAgentHarnessProbeContext
): Promise<{
  authenticated: boolean | null;
  ready: boolean;
  nextStep: "retry" | null;
  statusMessage: string | null;
}> {
  if (
    harness.kind === "cursor_agent" ||
    probeContext?.providerPassthroughEnabled === false
  ) {
    return {
      authenticated: null,
      nextStep: null,
      ready: true,
      statusMessage: harnessNativeLoginMessage(harness),
    };
  }

  const { routing } = await resolveCodingAgentSpawnBundle({
    harnessKind: harness.kind,
    profileModel: probeContext?.profileModel ?? null,
    userConfig: probeContext?.userConfig,
  });

  if (routing.active) {
    return {
      authenticated: true,
      nextStep: null,
      ready: true,
      statusMessage: `${harness.name} is installed and provider passthrough is active.`,
    };
  }

  return {
    authenticated: routing.configured ? false : null,
    nextStep: "retry",
    ready: false,
    statusMessage:
      routing.error ??
      `${harness.name} is installed but provider passthrough is not active. Check Settings → Provider.`,
  };
}

async function probeHarnessExec(
  harness: CodingAgentHarnessStatus,
  probeContext?: CodingAgentHarnessProbeContext
): Promise<{
  authenticated: boolean | null;
  ready: boolean;
  nextStep: "retry" | null;
  statusMessage: string | null;
}> {
  if (harness.kind === "cursor_agent") {
    return {
      authenticated: null,
      nextStep: null,
      ready: true,
      statusMessage: harnessNativeLoginMessage(harness),
    };
  }

  const passthrough = probeContext?.providerPassthroughEnabled !== false;
  const { spawn, routing } = passthrough
    ? await resolveCodingAgentSpawnBundle({
        harnessKind: harness.kind,
        profileModel: probeContext?.profileModel ?? null,
        userConfig: probeContext?.userConfig,
      })
    : {
        routing: {
          active: false,
          apiKey: null,
          baseUrl: null,
          compatible: false,
          configured: false,
          error: null,
          model: null,
          providerLabel: null,
          providerType: null,
        },
        spawn: { env: {} as Record<string, string> },
      };
  const tempDir = await mkdtemp(
    path.join(tmpdir(), "nakama-coding-agent-probe-")
  );

  const piProvider = routing.providerType
    ? mapNakamaProviderToPi(routing.providerType, routing.baseUrl)
    : null;
  const piModel =
    routing.model && routing.providerType
      ? formatModelForHarness("pi", routing.providerType, routing.model)
      : null;

  try {
    const result = await runProbeCommand(harness, tempDir, spawn.env, {
      model: piModel,
      provider: piProvider,
      timeoutMs: probeContext?.probeTimeoutMs,
    });
    const combinedOutput = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();

    if (result.timedOut) {
      return {
        authenticated: null,
        nextStep: "retry",
        ready: false,
        statusMessage: combinedOutput
          ? `Readiness check timed out. Last output from ${harness.name}: ${summarizeProbeOutput(combinedOutput)}`
          : "Readiness check timed out.",
      };
    }

    if (result.exitCode === 0) {
      return {
        authenticated: true,
        nextStep: null,
        ready: true,
        statusMessage: passthrough
          ? `${harness.name} is installed and ready via Nakama provider passthrough.`
          : harnessNativeLoginMessage(harness),
      };
    }

    if (looksLikeAuthenticationFailure(combinedOutput)) {
      const login = getCodingHarnessLoginCommand(harness.kind);
      const nativeHint = login
        ? `Run \`${login}\` on this server.`
        : "Authenticate the CLI on this server.";

      return {
        authenticated: false,
        nextStep: "retry",
        ready: false,
        statusMessage: passthrough
          ? (routing.error ??
            (combinedOutput
              ? `${harness.name} could not authenticate with the configured Nakama provider. ${summarizeProbeOutput(combinedOutput)} Check Settings → Provider.`
              : `${harness.name} could not authenticate with the configured Nakama provider. Check Settings → Provider.`))
          : combinedOutput
            ? `${harness.name} could not authenticate with harness login. ${summarizeProbeOutput(combinedOutput)} ${nativeHint}`
            : `${harness.name} could not authenticate with harness login. ${nativeHint}`,
      };
    }

    return {
      authenticated: null,
      nextStep: "retry",
      ready: false,
      statusMessage: combinedOutput
        ? `${harness.name} is installed but the readiness check failed (exit ${result.exitCode}). ${summarizeProbeOutput(combinedOutput)}`
        : `${harness.name} is installed but the readiness check failed (exit ${result.exitCode}).`,
    };
  } finally {
    await spawn.cleanup?.();
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function runProbeCommand(
  harness: CodingAgentHarnessStatus,
  cwd: string,
  spawnEnv: Record<string, string> = {},
  piOptions?: {
    model?: string | null;
    provider?: string | null;
    timeoutMs?: number;
  }
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = piOptions?.timeoutMs ?? 15_000;
  const prompt = "Reply with OK and nothing else.";
  const args = buildHarnessNonInteractiveArgs(harness.kind, {
    baseArgs: harness.args,
    cwd,
    piModel: piOptions?.model,
    piProvider: piOptions?.provider,
    prompt,
  });

  return new Promise((resolve) => {
    const child = spawn(harness.command, args, {
      cwd,
      env: mergeCodingAgentSpawnEnv(getToolExecutionEnv(), spawnEnv),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimeoutId = setTimeout(() => child.kill("SIGKILL"), SIGTERM_GRACE_MS);
      // Resolve here rather than waiting for `close`: a child that ignores
      // SIGTERM never emits one, so the caller would wait past the timeout it
      // just set.
      resolve({
        exitCode: null,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    }, timeoutMs);

    const finish = (result: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      finish({
        exitCode: null,
        stderr: `${stderr}\n${String(error)}`.trim(),
        stdout,
        timedOut,
      });
    });
    child.once("close", (exitCode) => {
      finish({
        exitCode,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    });
  });
}

function looksLikeAuthenticationFailure(output: string): boolean {
  return /log\s?in|login|sign\s?in|authenticate|authentication|not authenticated|api key|token|credential/i.test(
    output
  );
}

function summarizeProbeOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful =
    lines.find((line) => /^(?:error|fatal|panic):/i.test(line)) ??
    lines.find((line) =>
      /(?:error|failed|not found|invalid|unexpected|exception|traceback)/i.test(
        line
      )
    ) ??
    lines[lines.length - 1] ??
    output.trim();
  return meaningful.length > 240
    ? `${meaningful.slice(0, 237)}...`
    : meaningful;
}
