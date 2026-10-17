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
  type ToolContext,
  type UpdateAgentBrowserSettingsRequest,
  writeParsedConfigIni,
} from "@nakama/core";
import { z } from "zod";
import {
  ensureBunGlobalInstallDirs,
  ensureProcessPath,
} from "../lib/ensure-process-path";
import type { BashInput } from "../tools/bash";
import {
  buildPinnedPackageInstallPlan,
  detectNpmOrBun,
  downloadPinnedPackageTarball,
  type PinnedNpmPackage,
  probeCliVersion,
  runTimedInstallCommand,
  summarizeInstallOutput,
} from "./cli-package-install";

const AGENT_BROWSER_PACKAGE = "agent-browser";

const AGENT_BROWSER_COMMAND = "agent-browser";

const AGENT_BROWSER_SECTION = "agent_browser";

const AGENT_BROWSER_COMMAND_PATTERN = /(^|[\s;&|(`])agent-browser(?=\s|$)/;

const KERNEL_API_URL = "https://api.onkernel.com";

const KERNEL_REQUEST_TIMEOUT_MS = 30_000;

const AGENT_BROWSER_MAX_OUTPUT_CHARS = 20_000;

/** Idle time, counting live view use, before Kernel stops and saves the browser. */
const KERNEL_BROWSER_IDLE_SECONDS = 600;

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
 * provider wins over the CDP URL that points it at the session's browser.
 */
async function resolveAgentBrowserConfig(
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

const kernelBrowserSchema = z.object({
  browser_live_view_url: z.string().optional(),
  cdp_ws_url: z.string(),
  session_id: z.string(),
});

type KernelBrowser = z.infer<typeof kernelBrowserSchema>;

interface KernelProfileRequest {
  name: string;
}

interface KernelBrowserRequest {
  headless: boolean;
  name: string;
  profile: { name: string; save_changes: boolean };
  timeout_seconds: number;
}

function kernelName(...parts: string[]): string {
  return ["nakama", ...parts.map((part) => part.replace(/[^A-Za-z0-9_-]/g, ""))]
    .join("-")
    .slice(0, 255);
}

function kernelRequest(
  apiKey: string,
  method: "DELETE" | "GET" | "POST",
  path: string,
  body?: KernelBrowserRequest | KernelProfileRequest
): Promise<Response> {
  return fetch(`${KERNEL_API_URL}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method,
    signal: AbortSignal.timeout(KERNEL_REQUEST_TIMEOUT_MS),
  });
}

async function kernelFailure(
  response: Response,
  action: string
): Promise<NakamaApiError> {
  const detail = (await response.text().catch(() => "")).slice(0, 300);

  return new NakamaApiError(
    `Kernel could not ${action} (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    502
  );
}

async function getKernelBrowser(
  apiKey: string,
  name: string
): Promise<KernelBrowser | null> {
  const response = await kernelRequest(
    apiKey,
    "GET",
    `/browsers/${encodeURIComponent(name)}`
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await kernelFailure(response, "read the browser");
  }

  return kernelBrowserSchema.parse(await response.json());
}

interface SessionBrowserScope {
  orgId: string;
  profileId: string;
  sessionId: string;
}

/**
 * One Kernel browser per chat session, found again by its name, so every tool
 * call and the live view in the web UI drive the same browser. The Kernel
 * profile belongs to the agent: logins a user makes in the live view are saved
 * when the browser stops, and the agent's next browser starts signed in.
 */
async function ensureKernelBrowser(
  apiKey: string,
  scope: SessionBrowserScope
): Promise<KernelBrowser> {
  const name = kernelName(scope.orgId, scope.sessionId);
  const existing = await getKernelBrowser(apiKey, name);

  if (existing) {
    return existing;
  }

  const profileName = kernelName(scope.orgId, scope.profileId);

  const profile = await kernelRequest(apiKey, "POST", "/profiles", {
    name: profileName,
  });

  if (!(profile.ok || profile.status === 409)) {
    throw await kernelFailure(profile, "create the browser profile");
  }

  const created = await kernelRequest(apiKey, "POST", "/browsers", {
    headless: false,
    name,
    profile: { name: profileName, save_changes: true },
    timeout_seconds: KERNEL_BROWSER_IDLE_SECONDS,
  });

  if (created.status === 409) {
    const raced = await getKernelBrowser(apiKey, name);

    if (raced) {
      return raced;
    }
  }

  if (!created.ok) {
    throw await kernelFailure(created, "start a browser");
  }

  return kernelBrowserSchema.parse(await created.json());
}

async function requireKernelApiKey(): Promise<string> {
  const config = await resolveAgentBrowserConfig();

  if (!config?.apiKey) {
    throw new NakamaApiError("Kernel browser runtime is not configured.", 400);
  }

  return config.apiKey;
}

function toSessionBrowserResponse(
  browser: KernelBrowser | null
): SessionBrowserResponse {
  return { liveViewUrl: browser?.browser_live_view_url ?? null };
}

export async function getSessionBrowser(
  orgId: string,
  sessionId: string
): Promise<SessionBrowserResponse> {
  const config = await resolveAgentBrowserConfig();

  if (!config?.apiKey) {
    return toSessionBrowserResponse(null);
  }

  return toSessionBrowserResponse(
    await getKernelBrowser(config.apiKey, kernelName(orgId, sessionId))
  );
}

/** Deleting the Kernel browser is what saves its cookies to the profile. */
export async function stopSessionBrowser(
  orgId: string,
  sessionId: string
): Promise<void> {
  const response = await kernelRequest(
    await requireKernelApiKey(),
    "DELETE",
    `/browsers/${encodeURIComponent(kernelName(orgId, sessionId))}`
  );

  if (!(response.ok || response.status === 404)) {
    throw await kernelFailure(response, "stop the browser");
  }
}

/**
 * Connects agent-browser commands to the chat session's Kernel browser over
 * CDP. The API key stays on the server: the shell only gets the CDP URL of
 * that one browser.
 */
export async function enrichAgentBrowserBashInput(
  input: BashInput,
  context: ToolContext
): Promise<BashInput> {
  if (!AGENT_BROWSER_COMMAND_PATTERN.test(input.command)) {
    return input;
  }

  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  const config = await resolveAgentBrowserConfig();

  if (!(config?.apiKey && orgId && profileId)) {
    return input;
  }

  const browser = await ensureKernelBrowser(config.apiKey, {
    orgId,
    profileId,
    sessionId: context.sessionId?.trim() || profileId,
  });

  return {
    ...input,
    env: {
      // One LinkedIn snapshot runs past 30k characters; uncapped, a few of
      // them crowd out the rest of the conversation.
      AGENT_BROWSER_MAX_OUTPUT: String(AGENT_BROWSER_MAX_OUTPUT_CHARS),
      ...input.env,
      AGENT_BROWSER_CDP: browser.cdp_ws_url,
      // A new Kernel browser gets a new daemon session, so agent-browser never
      // reuses a CDP connection to a browser that already timed out.
      AGENT_BROWSER_SESSION: `kernel-${browser.session_id}`,
      KERNEL_API_KEY: "",
    },
  };
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
