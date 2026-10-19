import {
  type AgentBrowserProvider,
  type AgentBrowserStatusResponse,
  getUserConfigPath,
  maskTrailingSecret,
  NakamaApiError,
  parseIniWithSections,
  REDACTED_SECRET_VALUE,
  readTextOrNull,
  type SessionBrowserResponse,
  type UpdateAgentBrowserSettingsRequest,
  writeParsedConfigIni,
} from "@nakama/core";
import {
  ensureBunGlobalInstallDirs,
  ensureProcessPath,
} from "../lib/ensure-process-path";
import {
  buildPinnedPackageInstallPlan,
  detectNpmOrBun,
  downloadPinnedPackageTarball,
  type PinnedNpmPackage,
  probeCliVersion,
  runTimedInstallCommand,
  summarizeInstallOutput,
} from "./cli-package-install";
import {
  deleteKernelBrowser,
  getKernelBrowser,
  userBrowserName,
} from "./kernel-browser";

const AGENT_BROWSER_PACKAGE = "agent-browser";

const AGENT_BROWSER_COMMAND = "agent-browser";

const AGENT_BROWSER_SECTION = "agent_browser";

interface AgentBrowserConfig {
  apiKey: string;
  provider: AgentBrowserProvider;
}

/**
 * The reviewed release. Bumping the pin is a code change, and the hash is what
 * makes the bump checkable: a tampered tarball fails the install instead of
 * running lifecycle scripts as the server.
 */
const AGENT_BROWSER_PINNED_PACKAGE: PinnedNpmPackage = {
  integrity:
    "sha512-k58FCz0yUOCANoNkMiqJe+H2y6r6sUZazqXsWF+MYq1iRC42PjtLcBoag6SSTOD/FRQppvPDvE5HDYEhclvnhw==",
  name: AGENT_BROWSER_PACKAGE,
  version: "0.38.1",
};

export function getAgentBrowserInstallCommand(): string {
  const spec = `${AGENT_BROWSER_PACKAGE}@${AGENT_BROWSER_PINNED_PACKAGE.version}`;
  const manager = detectNpmOrBun();

  const install =
    manager === "bun"
      ? `bun install -g --trust ${spec}`
      : `npm install -g ${spec}`;

  return `${install} && ${AGENT_BROWSER_COMMAND} install`;
}

async function getAgentBrowserRuntimeStatus(): Promise<
  Pick<AgentBrowserStatusResponse, "installed" | "version">
> {
  const initial = await probeCliVersion(AGENT_BROWSER_COMMAND);

  if (initial.installed || !initial.missing) {
    return {
      installed: initial.installed,
      version: initial.version,
    };
  }

  ensureProcessPath();
  const retried = await probeCliVersion(AGENT_BROWSER_COMMAND);

  return {
    installed: retried.installed,
    version: retried.version,
  };
}

async function loadAgentBrowserConfig(): Promise<AgentBrowserConfig | null> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return null;
  }

  const section = parseIniWithSections(raw).sections[AGENT_BROWSER_SECTION];

  if (section?.provider?.trim() !== "kernel") {
    return null;
  }

  return { apiKey: section.api_key?.trim() ?? "", provider: "kernel" };
}

/**
 * Host env wins over the saved settings, so Docker and Kubernetes deployments
 * can set Kernel up with `NAKAMA_BROWSER_PROVIDER=kernel` and `KERNEL_API_KEY`.
 * Not `AGENT_BROWSER_PROVIDER`: agent-browser reads that name itself, and a
 * provider wins over the CDP URL that points it at the user's browser.
 */
export async function resolveAgentBrowserConfig(
  env: Record<string, string | undefined> = process.env
): Promise<AgentBrowserConfig | null> {
  const saved = await loadAgentBrowserConfig();
  const envProvider = env.NAKAMA_BROWSER_PROVIDER?.trim().toLowerCase();

  if (!(saved || envProvider === "kernel")) {
    return null;
  }

  return {
    apiKey: env.KERNEL_API_KEY?.trim() || saved?.apiKey || "",
    provider: "kernel",
  };
}

export async function isCloudBrowserRuntime(): Promise<boolean> {
  return Boolean((await resolveAgentBrowserConfig())?.apiKey);
}

export async function saveAgentBrowserConfig(
  input: UpdateAgentBrowserSettingsRequest,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  const raw = await readTextOrNull(getUserConfigPath());

  const parsed =
    raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);

  if (input.provider === null) {
    delete parsed.sections[AGENT_BROWSER_SECTION];
    await writeParsedConfigIni(parsed.global, parsed.sections);

    return;
  }

  if (input.provider !== undefined && input.provider !== "kernel") {
    throw new NakamaApiError(
      `Unsupported browser provider: ${String(input.provider)}.`,
      400
    );
  }

  const existing = await loadAgentBrowserConfig();
  const typed = input.apiKey?.trim() ?? "";

  const apiKey =
    typed && typed !== REDACTED_SECRET_VALUE ? typed : (existing?.apiKey ?? "");

  if (!(apiKey || env.KERNEL_API_KEY?.trim())) {
    throw new NakamaApiError("A Kernel API key is required.", 400);
  }

  parsed.sections[AGENT_BROWSER_SECTION] = {
    api_key: apiKey,
    provider: "kernel",
  };
  await writeParsedConfigIni(parsed.global, parsed.sections);
}

function toAgentBrowserStatusResponse(
  runtime: Pick<AgentBrowserStatusResponse, "installed" | "version">,
  config: AgentBrowserConfig | null
): AgentBrowserStatusResponse {
  const ready = runtime.installed && runtime.version !== null;

  return {
    apiKeyMasked: config ? maskTrailingSecret(config.apiKey) : null,
    installCommand: getAgentBrowserInstallCommand(),
    installed: runtime.installed,
    nextStep: ready ? null : "install",
    provider: config?.provider ?? null,
    ready,
    statusMessage: ready
      ? null
      : "agent-browser is not installed. Install it to enable browser automation.",
    version: runtime.version,
  };
}

export async function getAgentBrowserStatus(): Promise<AgentBrowserStatusResponse> {
  const [runtime, config] = await Promise.all([
    getAgentBrowserRuntimeStatus(),
    resolveAgentBrowserConfig(),
  ]);

  return toAgentBrowserStatusResponse(runtime, config);
}

async function requireKernelApiKey(): Promise<string> {
  const config = await resolveAgentBrowserConfig();

  if (!config?.apiKey) {
    throw new NakamaApiError("Kernel browser runtime is not configured.", 400);
  }

  return config.apiKey;
}

function toSessionBrowserResponse(
  browser: Awaited<ReturnType<typeof getKernelBrowser>>
): SessionBrowserResponse {
  return { liveViewUrl: browser?.browser_live_view_url ?? null };
}

export async function getUserBrowser(
  orgId: string,
  userId: string
): Promise<SessionBrowserResponse> {
  const config = await resolveAgentBrowserConfig();

  if (!config?.apiKey) {
    return toSessionBrowserResponse(null);
  }

  return toSessionBrowserResponse(
    await getKernelBrowser(config.apiKey, userBrowserName(orgId, userId))
  );
}

/** Deleting the Kernel browser is what saves its cookies to the profile. */
export async function stopUserBrowser(
  orgId: string,
  userId: string
): Promise<void> {
  await deleteKernelBrowser(
    await requireKernelApiKey(),
    userBrowserName(orgId, userId)
  );
}

export interface AgentBrowserInstallProgress {
  message: string;
}

export async function installAgentBrowser(
  onProgress?: (progress: AgentBrowserInstallProgress) => void,
  options: { registry?: string; signal?: AbortSignal } = {}
): Promise<AgentBrowserStatusResponse> {
  const emitProgress = (message: string) => {
    onProgress?.({ message });
  };

  emitProgress("Starting agent-browser install.");

  try {
    // Nothing is installed until the tarball matches the pinned hash, so a
    // compromised registry or mirror fails here rather than in a
    // lifecycle script running as the server.
    const tarball = await downloadPinnedPackageTarball(
      AGENT_BROWSER_PINNED_PACKAGE,
      {
        onProgress: emitProgress,
        registry: options.registry,
        signal: options.signal,
      }
    );

    try {
      const cliPlan = buildPinnedPackageInstallPlan(tarball.path);

      if (cliPlan.command === "bun") {
        ensureBunGlobalInstallDirs();
      }

      emitProgress(cliPlan.displayCommand);

      const cliResult = await runTimedInstallCommand(cliPlan, emitProgress, {
        signal: options.signal,
      });

      const cliOutput = [cliResult.stdout, cliResult.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();

      if (cliResult.timedOut) {
        throw new NakamaApiError(
          "Install timed out while installing the agent-browser CLI.",
          502
        );
      }

      if (cliResult.exitCode !== 0) {
        throw new NakamaApiError(
          cliOutput
            ? `agent-browser CLI install failed: ${summarizeInstallOutput(cliOutput)}`
            : "agent-browser CLI install failed.",
          502
        );
      }
    } finally {
      await tarball.cleanup();
    }
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw error;
    }

    throw new NakamaApiError(
      `agent-browser CLI install refused: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502
    );
  }

  // The browser download is the long half, so starting it after the caller has
  // gone is the case this guards. The abort is checked between the two commands
  // as well as inside each one.
  if (options.signal?.aborted) {
    throw new NakamaApiError(
      "Install cancelled before the agent-browser download started.",
      502
    );
  }

  ensureProcessPath();
  emitProgress(`${AGENT_BROWSER_COMMAND} install`);

  const browserResult = await runTimedInstallCommand(
    {
      args: ["install"],
      command: AGENT_BROWSER_COMMAND,
      displayCommand: `${AGENT_BROWSER_COMMAND} install`,
    },
    emitProgress,
    { signal: options.signal }
  );

  const browserOutput = [browserResult.stdout, browserResult.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (browserResult.timedOut) {
    throw new NakamaApiError(
      "Install timed out while downloading Chrome for agent-browser.",
      502
    );
  }

  if (browserResult.exitCode !== 0) {
    throw new NakamaApiError(
      browserOutput
        ? `agent-browser browser install failed: ${summarizeInstallOutput(browserOutput)}`
        : "agent-browser browser install failed.",
      502
    );
  }

  emitProgress("agent-browser install finished. Refreshing readiness.");

  return getAgentBrowserStatus();
}
