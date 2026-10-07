import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearAutomationWorkerHeartbeat,
  saveComposioConfig,
  type WorkerProcessInfo,
  writeAutomationWorkerHeartbeat,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "./agent-service";
import { LlmUsageTracker } from "./llm-usage-tracker";
import { SystemStatusService } from "./system-status-service";

let configDir: string | null = null;

afterEach(async () => {
  await clearAutomationWorkerHeartbeat();

  if (configDir) {
    await rm(configDir, { force: true, recursive: true });
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
    llmUsageTracker?: LlmUsageTracker;
  }
) {
  const usageTracker = extras?.llmUsageTracker;

  return new SystemStatusService(
    // The service only reads these members; the rest of AgentService is not
    // part of what a status response depends on.
    {
      getLlmUsageStats: async (orgId: string | null) =>
        (orgId ? await usageTracker?.getStats(orgId) : null) ?? {
          estimatedCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          requestCount: 0,
          totalTokens: 0,
          trackedSince: new Date().toISOString(),
        },
      getLlmUsageStatsByModel: async (orgId: string | null) =>
        (orgId ? await usageTracker?.getStatsByModel(orgId) : null) ?? [],
      getModels: async () => ({ models: [], provider: "openai" }),
      getUsageStatusFields: () => ({
        costEstimated: false,
        currentModel: "gpt-4o",
        displayName: "OpenAI",
      }),
      providerConfigured: true,
    } as unknown as AgentService,
    { getActiveRunCount: () => 2 } as any,
    {
      getAllWorkerStatuses: async () => ({
        automation: automationProcess,
        telegram: null,
        whatsapp: null,
      }),
    } as any,
    null,
    extras?.composioService as any
  );
}

describe("SystemStatusService", () => {
  test("adds named usage per agent and per user only when asked", async () => {
    await withConfigDir();
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "agent_1",
      isSuper: false,
      model: null,
      name: "Researcher",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });
    await db.createUser({
      createdAt: now,
      email: "ana@example.com",
      id: "user_1",
      name: "Ana",
      passwordHash: "x",
      updatedAt: now,
    });
    const tracker = new LlmUsageTracker(db);
    tracker.record("gpt-4o", 100, 10, {
      orgId: "org_a",
      profileId: "agent_1",
      userId: "user_1",
    });
    tracker.record("gpt-4o", 50, 5, { orgId: "org_a" });
    const agent = new AgentService(null, null, db, tracker);
    const service = new SystemStatusService(
      Object.assign(agent, {
        getModels: async () => ({ models: [], provider: "openai" }),
      }),
      { getActiveRunCount: () => 0 } as any,
      { getAllWorkerStatuses: async () => ({}) } as any
    );

    const plain = await service.getStatus("org_a");
    expect(plain.llmUsage.agents).toBeUndefined();
    expect(plain.llmUsage.users).toBeUndefined();

    const { llmUsage } = await service.getStatus("org_a", {
      includeUsageByActor: true,
    });
    expect(llmUsage.agents).toMatchObject([
      { id: "agent_1", name: "Researcher", requestCount: 1 },
      { id: null, name: null, requestCount: 1 },
    ]);
    expect(llmUsage.users).toMatchObject([
      { id: "user_1", name: "Ana", requestCount: 1 },
      { id: null, name: null, requestCount: 1 },
    ]);
  });

  test("reports automation worker from PM2 status plus fresh heartbeat", async () => {
    await withConfigDir();
    await writeAutomationWorkerHeartbeat(true, 5, process.pid);

    const service = createService({
      cpuPercent: 1.2,
      managed: true,
      memoryMb: 12.5,
      status: "online",
      uptimeSeconds: 30,
    });

    const status = await service.getStatus(null);

    expect(status.automationWorker).toEqual({
      activeRuns: 2,
      ok: true,
      process: {
        cpuPercent: 1.2,
        managed: true,
        memoryMb: 12.5,
        status: "online",
        uptimeSeconds: 30,
      },
      providerConfigured: true,
      running: true,
      scheduledJobs: 5,
    });
  });

  test("reports automation worker not ok when heartbeat is stale", async () => {
    await withConfigDir();
    await writeAutomationWorkerHeartbeat(
      true,
      5,
      process.pid,
      new Date(Date.now() - 60_000).toISOString()
    );

    const service = createService({
      cpuPercent: 0,
      managed: true,
      memoryMb: 0,
      status: "online",
      uptimeSeconds: 30,
    });

    const status = await service.getStatus(null);

    expect(status.automationWorker.ok).toBe(false);
    expect(status.automationWorker.running).toBe(false);
    expect(status.automationWorker.scheduledJobs).toBe(0);
  });

  test("reports automation worker process when PM2 is unavailable", async () => {
    await withConfigDir();

    const service = createService({
      cpuPercent: null,
      managed: false,
      memoryMb: null,
      status: null,
      uptimeSeconds: null,
    });

    const status = await service.getStatus(null);

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

    const status = await service.getStatus(null);

    expect(reachabilityCalls).toBe(1);
    expect(status.server).toMatchObject({
      composioAvailable: true,
      composioConfigured: true,
    });
  });

  test("usage is org scoped", async () => {
    await withConfigDir();
    const tracker = new LlmUsageTracker(createInMemoryDatabaseAdapter());

    tracker.record("gpt-4o", 100, 50, { orgId: "org_a" });
    tracker.record("gpt-4o", 900_000, 400_000, { orgId: "org_b" });

    const service = createService(null, { llmUsageTracker: tracker });

    const orgA = await service.getStatus("org_a");
    const orgB = await service.getStatus("org_b");

    expect(orgA.llmUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      requestCount: 1,
      totalTokens: 150,
    });
    expect(orgA.llmUsage.models).toMatchObject([
      { inputTokens: 100, modelId: "gpt-4o", requestCount: 1 },
    ]);
    expect(orgB.llmUsage).toMatchObject({
      inputTokens: 900_000,
      outputTokens: 400_000,
      requestCount: 1,
      totalTokens: 1_300_000,
    });
    expect(orgB.llmUsage.models).toMatchObject([
      { inputTokens: 900_000, modelId: "gpt-4o", requestCount: 1 },
    ]);
  });
});
