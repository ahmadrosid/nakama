import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureProcessPath } from "./lib/ensure-process-path";

ensureProcessPath();
import { createHonoApp } from "./http/app";
import { AgentService } from "./services/agent-service";
import { AutomationRunner } from "./services/automation-runner";
import { AutomationDeliveryService } from "./services/automation-delivery-service";
import { AutomationService } from "./services/automation-service";
import { TaskRunner } from "./services/task-runner";
import { TaskService } from "./services/task-service";
import { SystemStatusService } from "./services/system-status-service";
import { WorkerManagerService } from "./services/worker-manager-service";
import { LlmUsageTracker } from "./services/llm-usage-tracker";
import { ensureProviderConfigured } from "./setup";
import { resolveWebDistDir } from "./static-web";
import { McpClientManager } from "./services/mcp-client-manager";
import { McpService } from "./services/mcp-service";
import {
  createMcpAwareEmailOutboundAdapter,
  hasAutomationEmailDeliveryPath,
} from "./services/mcp-email-delivery";
import { ComposioService } from "./services/composio-service";
import { SkillsService } from "./services/skills-service";
import { AuthService } from "./services/auth-service";
import { OrgService } from "./services/org-service";
import {
  createAutomationRunHistoryTools,
  createAutomationTools,
} from "./tools/automation-tools";
import { NAKAMA_API_VERSION } from "@nakama/core";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  clearRuntimeServerUrl,
  getUserConfigDir,
  loadConfig,
  writeRuntimeServerUrl,
} from "@nakama/core";
import {
  serverHasCodingHarnessVerify,
  serverHasTaskChat,
} from "@nakama/core/ensure-server";
import { ensureBundledSkillFiles } from "@nakama/core";
import { createDatabase, ensureBundledSkillsAssigned, seedDatabase, type Database } from "@nakama/db";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const host = process.env.NAKAMA_HOST ?? DEFAULT_SERVER_HOST;
const requestedPort = parsePort(process.env.NAKAMA_PORT);
const canFallbackToNextPort = process.env.NAKAMA_PORT == null;

const existingServerUrl = await findRunningNakamaServerUrl(host, requestedPort);

if (existingServerUrl) {
  const runtimeServerUrl = writeRuntimeServerUrl(existingServerUrl);
  console.log(`Nakama server already running on ${runtimeServerUrl}`);
  console.log(
    "Stop it before restarting to pick up code changes (for example: kill $(lsof -ti :4310)).",
  );
  console.log("Or run: bun run dev:server");
  process.exit(0);
}

const { provider, userConfig } = await ensureProviderConfigured();
const config = loadConfig();
const database = await createDatabase(config.databaseUrl, { baseDir: getUserConfigDir() });

await seedDatabase(database.adapter);

const authService = new AuthService();

const llmUsageTracker = await LlmUsageTracker.create(database.adapter);
const agent = new AgentService(userConfig, provider, database.adapter, llmUsageTracker);
await agent.ensureVisionSettingsLoaded();
await agent.ensureTranscriptionSettingsLoaded();
const mcpClientManager = new McpClientManager();
const mcpService = new McpService(database.adapter, mcpClientManager);
const composioService = new ComposioService(database.adapter, authService);
const skillsService = new SkillsService(database.adapter);

agent.setMcpClientManager(mcpClientManager);
agent.setMcpService(mcpService);
agent.setComposioService(composioService);
agent.setSkillsService(skillsService);

const automationService = new AutomationService(database.adapter, {
  getUserTimezone: () => agent.getUserTimezone(),
  canSendEmail: (profileId, _orgId) =>
    hasAutomationEmailDeliveryPath(database.adapter, profileId),
});
const automationDeliveryService = new AutomationDeliveryService(automationService, {
  email: createMcpAwareEmailOutboundAdapter(database.adapter, mcpClientManager),
});
const automationRunner = new AutomationRunner(
  automationService,
  agent,
  automationDeliveryService,
);

agent.setAutomationTools(createAutomationTools(automationService, automationRunner));
agent.setAutomationRunHistoryTools(createAutomationRunHistoryTools(automationService));
agent.setAutomationRunner(automationRunner);

const taskService = new TaskService(database.adapter);
const taskRunner = new TaskRunner(taskService, agent);
taskService.setTaskRunner(taskRunner);
agent.setTaskRunner(taskRunner);

const workerManager = new WorkerManagerService(projectRoot);

const orgService = new OrgService(database.adapter, authService);

const systemStatus = new SystemStatusService(
  agent,
  automationRunner,
  taskRunner,
  workerManager,
  mcpService,
  composioService,
  database.adapter,
);

const webDistDir = resolveWebDistDir(projectRoot);
const app = createHonoApp({
  agent,
  automationService,
  taskService,
  systemStatus,
  workerManager,
  mcpService,
  composioService,
  authService,
  orgService,
  databaseAdapter: database.adapter,
  webDistDir,
});

const server = startServer({
  host,
  preferredPort: requestedPort,
  canFallbackToNextPort,
  fetch: app.fetch,
});
const serverUrl = writeRuntimeServerUrl(
  `http://${server.hostname}:${server.port}`,
);

registerRuntimeCleanup(server, serverUrl, database, mcpClientManager);

if (server.port !== requestedPort) {
  console.log(`Port ${requestedPort} is busy. Using ${server.port} instead.`);
}

console.log(`Nakama server listening on ${serverUrl}`);
console.log(`Nakama database ready at ${config.databaseUrl}`);

void initializeOptionalServices({
  mcpService,
  skillsService,
  agent,
  database,
});

try {
  await workerManager.recoverDesiredWorkers();
} catch (error) {
  console.warn("Could not recover platform workers:", error);
}

if (webDistDir) {
  console.log(`Nakama web dashboard ready at ${serverUrl}`);
}

const humanUserCount = await database.adapter.countHumanUsers();
if (humanUserCount > 0 && !agent.providerConfigured) {
  console.warn(
    `Provider not configured — complete the setup wizard at ${serverUrl}/setup to enable chat and automations.`,
  );
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_SERVER_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid NAKAMA_PORT: ${value}`);
  }

  return port;
}

async function initializeOptionalServices(options: {
  mcpService: McpService;
  skillsService: SkillsService;
  agent: AgentService;
  database: Database;
}): Promise<void> {
  try {
    await options.mcpService.connectEnabledServers();
  } catch (error) {
    console.warn("Could not connect MCP servers:", error);
  }

  try {
    await ensureBundledSkillFiles();
  } catch (error) {
    console.warn("Could not install bundled skills:", error);
  }

  try {
    await options.skillsService.syncDiscoveredSkills();
    await ensureBundledSkillsAssigned(options.database.adapter);
  } catch (error) {
    console.warn("Could not sync skills:", error);
  }

  try {
    await options.agent.ensureSoulScaffolded();
  } catch (error) {
    console.warn("Could not scaffold soul templates:", error);
  }
}

function startServer(options: {
  host: string;
  preferredPort: number;
  canFallbackToNextPort: boolean;
  fetch: (request: Request) => Response | Promise<Response>;
}): ReturnType<typeof Bun.serve> {
  const lastPort = options.canFallbackToNextPort
    ? Math.min(options.preferredPort + 2000, 65535)
    : options.preferredPort;
  let lastError: unknown;

  for (let port = options.preferredPort; port <= lastPort; port += 1) {

    try {
      return Bun.serve({
        hostname: options.host,
        port,
        idleTimeout: 255,
        fetch: options.fetch,
      });
    } catch (error) {
      if (!isAddressInUseError(error) || !options.canFallbackToNextPort) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError ?? new Error("Failed to find an open port for the Nakama server.");
}

function isAddressInUseError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

function registerRuntimeCleanup(
  server: ReturnType<typeof Bun.serve>,
  serverUrl: string,
  database: Database,
  mcpClientManager: McpClientManager,
): void {
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    void mcpClientManager.disconnectAll();
    clearRuntimeServerUrl(serverUrl);
    database.close();
  };

  process.on("exit", cleanup);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      server.stop(true);
      process.exit(0);
    });
  }
}

async function findRunningNakamaServerUrl(
  host: string,
  port: number,
): Promise<string | null> {
  const serverUrl = `http://${normalizeHealthCheckHost(host)}:${port}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 400);

  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      ok?: boolean;
      apiVersion?: number;
    };
    const hasTaskChat = await serverHasTaskChat(serverUrl, controller.signal);
    const hasCodingHarnessVerify = await serverHasCodingHarnessVerify(serverUrl, controller.signal);
    return payload.ok === true &&
      payload.apiVersion === NAKAMA_API_VERSION &&
      hasTaskChat &&
      hasCodingHarnessVerify
      ? serverUrl
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeHealthCheckHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return DEFAULT_SERVER_HOST;
  }

  return host;
}
