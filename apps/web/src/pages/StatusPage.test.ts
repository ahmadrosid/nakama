import type { SystemStatusResponse } from "@nakama/core/contract";
import { describe, expect, test } from "bun:test";
import { buildServiceColumns, deriveSummary } from "./StatusPage";

const healthyStatus: SystemStatusResponse = {
  checkedAt: "2026-06-22T10:00:00.000Z",
  server: {
    ok: true,
    apiVersion: 1,
    providerConfigured: true,
    userConfigured: true,
  },
  automationWorker: {
    ok: true,
    running: true,
    providerConfigured: true,
    scheduledJobs: 1,
    activeRuns: 0,
    process: {
      managed: true,
      status: "online",
      cpuPercent: 0,
      memoryMb: 12,
      uptimeSeconds: 30,
    },
  },
  taskWorker: { ok: true, activeRuns: 0, providerConfigured: true },
  telegramWorker: { ok: true, configured: true, running: true, paired: true },
  whatsappWorker: {
    ok: true,
    configured: true,
    running: true,
    paired: true,
    connected: true,
    qrCode: null,
  },
  mcp: { serverCount: 0, connectedCount: 0, assignedProfileCount: 0 },
  llmUsage: {
    providerConfigured: true,
    provider: "openai",
    displayName: "OpenAI",
    currentModel: "gpt-4o",
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    costEstimated: false,
    totalTokens: 0,
    trackedSince: "2026-06-22T10:00:00.000Z",
    models: [],
  },
};

describe("StatusPage helpers", () => {
  test("summarizes the overall system state", () => {
    expect(deriveSummary(healthyStatus)).toEqual({
      tone: "ok",
      title: "All systems operational",
      description: "Server, workers, and bridges are healthy.",
    });
  });

  test("tells users to start the automation worker when it is stopped", () => {
    const status = {
      ...healthyStatus,
      automationWorker: {
        ...healthyStatus.automationWorker,
        ok: false,
        running: false,
      },
    };

    expect(deriveSummary(status)).toEqual({
      tone: "bad",
      title: "Automation worker stopped",
      description: "Start the automation worker to resume scheduled runs.",
    });
  });

  test("maps bridge health to service columns", () => {
    const columns = buildServiceColumns(healthyStatus);
    expect(columns.map((column) => column.title)).toEqual(["Automation", "Telegram", "WhatsApp"]);
    expect(columns.map((column) => column.status)).toEqual(["Healthy", "Healthy", "Healthy"]);
  });

  test("marks automation as PM2 unavailable when no managed process is present", () => {
    const columns = buildServiceColumns({
      ...healthyStatus,
      automationWorker: {
        ...healthyStatus.automationWorker,
        process: undefined,
      },
    });

    expect(columns[0]).toMatchObject({
      title: "Automation",
      status: "PM2 unavailable",
      tone: "warn",
    });
  });
});
