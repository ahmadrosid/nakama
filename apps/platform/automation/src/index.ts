import { NakamaClient } from "@nakama/client";
import {
  clearAutomationWorkerHeartbeat,
  writeAutomationWorkerHeartbeat,
} from "@nakama/core/automation-worker";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { AUTOMATION_POLL_INTERVAL_MS, loadConfig } from "./config";
import { AutomationWorkerScheduler } from "./scheduler";

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

  console.log("Nakama automation worker running.");
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
}
