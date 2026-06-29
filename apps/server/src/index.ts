import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { SkillsService } from "./services/skills-service";
import { AuthService } from "./services/auth-service";
import { OrgService } from "./services/org-service";
import { createAutomationTools } from "./tools/automation-tools";
import { TINYCLAW_API_VERSION } from "@tinyclaw/core";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  clearRuntimeServerUrl,
  getUserConfigDir,
  loadConfig,
  writeRuntimeServerUrl,
} from "@tinyclaw/core";
import { serverHasTaskChat } from "@tinyclaw/core/ensure-server";
import { ensureBundledSkillFiles } from "@tinyclaw/core";
import { createDatabase, ensureBundledSkillsAssigned, seedDatabase, type Database } from "@tinyclaw/db";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const host = process.env.TINYCLAW_HOST ?? DEFAULT_SERVER_HOST;
const requestedPort = parsePort(process.env.TINYCLAW_PORT);
const canFallbackToNextPort = process.env.TINYCLAW_PORT == null;

const existingServerUrl = await findRunningTinyClawServerUrl(host, requestedPort);

if (existingServerUrl) {
  const runtimeServerUrl = writeRuntimeServerUrl(existingServerUrl);
  console.log(`TinyClaw server already running on ${runtimeServerUrl}`);
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
const skillsService = new SkillsService(database.adapter);

agent.setMcpClientManager(mcpClientManager);
agent.setMcpService(mcpService);
agent.setSkillsService(skillsService);

try {
  await mcpService.connectEnabledServers();
} catch (error) {
  console.warn("Could not connect MCP servers:", error);
}

try {
  await ensureBundledSkillFiles();
} catch (error) {
  console.warn("Could not install bundled skills:", error);
}

try {
  await skillsService.syncDiscoveredSkills();
  await ensureBundledSkillsAssigned(database.adapter);
} catch (error) {
  console.warn("Could not sync skills:", error);
}

try {
  await agent.ensureSoulScaffolded();
} catch (error) {
  console.warn("Could not scaffold soul templates:", error);
}

const automationService = new AutomationService(database.adapter, {
  getUserTimezone: () => agent.getUserTimezone(),
});
const automationDeliveryService = new AutomationDeliveryService(automationService);
const automationRunner = new AutomationRunner(
  automationService,
  agent,
  automationDeliveryService,
);

agent.setAutomationTools(createAutomationTools(automationService, automationRunner));
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
);

const webDistDir = resolveWebDistDir(projectRoot);
const app = createHonoApp({
  agent,
  automationService,
  taskService,
  systemStatus,
  workerManager,
  mcpService,
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

console.log(`TinyClaw server listening on ${serverUrl}`);
console.log(`TinyClaw database ready at ${config.databaseUrl}`);

try {
  await workerManager.recoverDesiredWorkers();
} catch (error) {
  console.warn("Could not recover platform workers:", error);
}

if (webDistDir) {
  console.log(`TinyClaw web dashboard ready at ${serverUrl}`);
}

if (!provider) {
  console.log("Provider not configured. Chat will run in offline mode.");
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_SERVER_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid TINYCLAW_PORT: ${value}`);
  }

  return port;
}

function startServer(options: {
  host: string;
  preferredPort: number;
  canFallbackToNextPort: boolean;
  fetch: (request: Request) => Promise<Response>;
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

  throw lastError ?? new Error("Failed to find an open port for the TinyClaw server.");
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

async function findRunningTinyClawServerUrl(
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
    return payload.ok === true &&
      payload.apiVersion === TINYCLAW_API_VERSION &&
      hasTaskChat
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
