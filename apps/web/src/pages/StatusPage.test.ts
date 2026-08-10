import { describe, expect, test } from "bun:test";
import type { SystemStatusResponse } from "@nakama/core/contract";
import { buildServiceColumns, deriveSummary } from "./status-page.shared";

const healthyStatus: SystemStatusResponse = {
  automationWorker: {
    activeRuns: 0,
    ok: true,
    process: {
      cpuPercent: 0,
      managed: true,
      memoryMb: 12,
      status: "online",
      uptimeSeconds: 30,
    },
    providerConfigured: true,
    running: true,
    scheduledJobs: 1,
  },
  checkedAt: "2026-06-22T10:00:00.000Z",
  discordWorker: {
    configured: true,
    connected: true,
    ok: true,
    paired: true,
    running: true,
  },
  llmUsage: {
    costEstimated: false,
    currentModel: "gpt-4o",
    displayName: "OpenAI",
    estimatedCostUsd: 0,
    inputTokens: 0,
    models: [],
    outputTokens: 0,
    provider: "openai",
    providerConfigured: true,
    requestCount: 0,
    totalTokens: 0,
    trackedSince: "2026-06-22T10:00:00.000Z",
  },
  mcp: { assignedProfileCount: 0, connectedCount: 0, serverCount: 0 },
  server: {
    apiVersion: 1,
    composioAvailable: false,
    composioConfigured: false,
    ok: true,
    providerConfigured: true,
    userConfigured: true,
  },
  taskWorker: { activeRuns: 0, ok: true, providerConfigured: true },
  telegramWorker: { configured: true, ok: true, paired: true, running: true },
  whatsappWorker: {
    configured: true,
    connected: true,
    ok: true,
    paired: true,
    qrCode: null,
    running: true,
  },
};

describe("StatusPage helpers", () => {
  test("summarizes the overall system state", () => {
    expect(deriveSummary(healthyStatus)).toEqual({
      description: "Server, workers, and bridges are healthy.",
      title: "All systems operational",
      tone: "ok",
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
      description: "Start the automation worker to resume scheduled runs.",
      title: "Automation worker stopped",
      tone: "bad",
    });
  });

  test("points bridge-offline warnings at Integrations", () => {
    const status = {
      ...healthyStatus,
      telegramWorker: {
        ...healthyStatus.telegramWorker,
        ok: false,
        running: false,
      },
    };

    expect(deriveSummary(status)).toEqual({
      action: { label: "Open Integrations", to: "/integrations" },
      description:
        "Start the Telegram worker (bun run dev:telegram) to receive messages.",
      title: "Telegram bridge offline",
      tone: "warn",
    });
  });

  test("points provider warnings at Settings", () => {
    const status = {
      ...healthyStatus,
      server: {
        ...healthyStatus.server,
        providerConfigured: false,
      },
    };

    expect(deriveSummary(status)).toEqual({
      action: { label: "Open Settings", to: "/settings" },
      description:
        "Configure an LLM provider before chat or automation runs can succeed.",
      title: "Running with warnings",
      tone: "warn",
    });
  });

  test("maps bridge health to service columns", () => {
    const columns = buildServiceColumns(healthyStatus);
    expect(columns.map((column) => column.title)).toEqual([
      "Automation",
      "Telegram",
      "WhatsApp",
      "Discord",
    ]);
    expect(columns.map((column) => column.status)).toEqual([
      "Healthy",
      "Healthy",
      "Healthy",
      "Healthy",
    ]);
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
      status: "PM2 unavailable",
      title: "Automation",
      tone: "warn",
    });
  });
});
