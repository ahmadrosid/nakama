import { NakamaClient } from "@nakama/client";
import { log } from "@nakama/core";
import {
  clearAutomationWorkerHeartbeat,
  writeAutomationWorkerHeartbeat,
} from "@nakama/core/automation-worker";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { AutomationWorkerScheduler } from "./scheduler";

const AUTOMATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

interface AutomationWorkerConfig {
  heartbeatIntervalMs: number;
  serverUrl: string;
}

function loadConfig(): AutomationWorkerConfig {
  return {
    heartbeatIntervalMs: Number.parseInt(
      process.env.NAKAMA_AUTOMATION_HEARTBEAT_INTERVAL_MS ?? "15000",
      10
    ),
    serverUrl: process.env.NAKAMA_SERVER_URL?.trim() || "http://127.0.0.1:4310",
  };
}

let spawnedChild: Bun.Subprocess | null = null;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

let scheduler: AutomationWorkerScheduler | null = null;

registerCleanupHandlers(async () => {
  scheduler?.stop();

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  await clearAutomationWorkerHeartbeat();
  stopSpawnedServer(spawnedChild);
});

try {
  const config = loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = new NakamaClient({
    authToken: await loadLocalAuthToken(),
    baseUrl: serverUrl,
  });

  const health = await client.health();

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Automations will run in offline mode until an API key is set."
    );
  }

  scheduler = new AutomationWorkerScheduler(client, (status) => {
    void writeAutomationWorkerHeartbeat(status.running, status.scheduledJobs);
  });

  await scheduler.start();

  const workerSettings = await client
    .getAutomationWorkerSettings()
    .catch(() => ({
      pollIntervalMinutes: AUTOMATION_POLL_INTERVAL_MS / (60 * 1000),
    }));

  scheduler.beginPolling(workerSettings.pollIntervalMinutes * 60 * 1000);

  heartbeatTimer = setInterval(() => {
    const status = scheduler?.getStatus?.() ?? {
      running: true,
      scheduledJobs: 0,
    };

    void writeAutomationWorkerHeartbeat(status.running, status.scheduledJobs);
  }, config.heartbeatIntervalMs);

  await writeAutomationWorkerHeartbeat(true, 0);

  log("info", "worker.started", { worker: "automation" });
  console.log(`Server: ${serverUrl}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  stopSpawnedServer(spawnedChild);
  process.exit(1);
}

function registerCleanupHandlers(cleanup: () => void | Promise<void>): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, async () => {
      await cleanup();
      process.exit(0);
    });
  }

  // pm2 stops Windows workers with a "shutdown" message instead of a signal.
  if (process.platform === "win32") {
    process.on("message", async (message) => {
      if (message === "shutdown") {
        await cleanup();
        process.exit(0);
      }
    });
  }
}
