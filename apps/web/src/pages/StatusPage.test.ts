import type { SystemStatusResponse } from "@tinyclaw/core/contract";
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

  test("maps bridge health to service columns", () => {
    const columns = buildServiceColumns(healthyStatus);
    expect(columns.map((column) => column.title)).toEqual(["Telegram", "WhatsApp"]);
    expect(columns.map((column) => column.status)).toEqual(["Healthy", "Healthy"]);
  });
});
