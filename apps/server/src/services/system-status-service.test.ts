import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearAutomationWorkerHeartbeat,
  saveComposioConfig,
  writeAutomationWorkerHeartbeat,
  type WorkerProcessInfo,
} from "@nakama/core";
import { SystemStatusService } from "./system-status-service";

let configDir: string | null = null;

afterEach(async () => {
  await clearAutomationWorkerHeartbeat();

  if (configDir) {
    await rm(configDir, { recursive: true, force: true });
    configDir = null;
  }

  delete process.env.NAKAMA_CONFIG_DIR;
});

async function withConfigDir(): Promise<void> {
  configDir = await mkdtemp(join(tmpdir(), "nakama-system-status-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
}

function createService(
  automationProcess: WorkerProcessInfo | null,
  extras?: {
    composioService?: { isReachable: () => Promise<boolean> } | null;
  },
) {
  return new SystemStatusService(
    {
      providerConfigured: true,
      getModels: async () => ({ provider: "openai", models: [] }),
      getUsageStatusFields: () => ({ currentModel: "gpt-4o", displayName: "OpenAI", costEstimated: false }),
      getLlmUsageStats: () => ({
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        trackedSince: new Date().toISOString(),
      }),
      getLlmUsageStatsByModel: () => [],
    } as any,
    { getActiveRunCount: () => 2 } as any,
    { getActiveRunCount: () => 1 } as any,
    {
      getAllWorkerStatuses: async () => ({
        automation: automationProcess,
        telegram: null,
        whatsapp: null,
      }),
    } as any,
    null,
    extras?.composioService as any,
  );
}

describe("SystemStatusService", () => {
  test("reports automation worker from PM2 status plus fresh heartbeat", async () => {
    await withConfigDir();
    await writeAutomationWorkerHeartbeat(true, 5, process.pid);

    const service = createService({
      managed: true,
      status: "online",
      cpuPercent: 1.2,
      memoryMb: 12.5,
      uptimeSeconds: 30,
    });

    const status = await service.getStatus();

    expect(status.automationWorker).toEqual({
      ok: true,
      running: true,
      scheduledJobs: 5,
      activeRuns: 2,
      providerConfigured: true,
      process: {
        managed: true,
        status: "online",
        cpuPercent: 1.2,
        memoryMb: 12.5,
        uptimeSeconds: 30,
      },
    });
  });

  test("reports automation worker not ok when heartbeat is stale", async () => {
    await withConfigDir();
    await writeAutomationWorkerHeartbeat(
      true,
      5,
      process.pid,
      new Date(Date.now() - 60_000).toISOString(),
    );

    const service = createService({
      managed: true,
      status: "online",
      cpuPercent: 0,
      memoryMb: 0,
      uptimeSeconds: 30,
    });

    const status = await service.getStatus();

    expect(status.automationWorker.ok).toBe(false);
    expect(status.automationWorker.running).toBe(false);
    expect(status.automationWorker.scheduledJobs).toBe(0);
  });

  test("reports automation worker process when PM2 is unavailable", async () => {
    await withConfigDir();

    const service = createService({
      managed: false,
      status: null,
      cpuPercent: null,
      memoryMb: null,
      uptimeSeconds: null,
    });

    const status = await service.getStatus();

    expect(status.automationWorker.ok).toBe(false);
    expect(status.automationWorker.process?.managed).toBe(false);
  });

  test("probes Composio reachability on system status when configured", async () => {
    await withConfigDir();
    await saveComposioConfig({ apiKey: "test-key" });

    let reachabilityCalls = 0;
    const service = createService(null, {
      composioService: {
        isReachable: async () => {
          reachabilityCalls += 1;
          return true;
        },
      },
    });

    const status = await service.getStatus();

    expect(reachabilityCalls).toBe(1);
    expect(status.server).toMatchObject({
      composioConfigured: true,
      composioAvailable: true,
    });
  });
});
