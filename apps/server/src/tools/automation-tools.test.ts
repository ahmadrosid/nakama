import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AutomationRunner } from "../services/automation-runner";
import { AutomationService } from "../services/automation-service";
import {
  createAutomationRunHistoryTools,
  createAutomationTools,
} from "./automation-tools";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";
const TOOL_CONTEXT = { orgId: ORG_ID, profileId: PROFILE_ID };

async function createTestDb() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    updatedAt: now,
  });

  await db.upsertProfile({
    createdAt: now,
    id: PROFILE_ID,
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default Bot",
    orgId: ORG_ID,
    systemPrompt: "",
    updatedAt: now,
  });

  return db;
}

function getRunAutomationTool(
  service: AutomationService,
  runner: AutomationRunner
) {
  const tool = createAutomationTools(service, runner).find(
    (entry) => entry.name === "run_automation"
  );

  if (!tool) {
    throw new Error("run_automation tool not found");
  }

  return tool;
}

function getPreviousAutomationRunsTool(service: AutomationService) {
  const tool = createAutomationRunHistoryTools(service).find(
    (entry) => entry.name === "list_previous_automation_runs"
  );

  if (!tool) {
    throw new Error("list_previous_automation_runs tool not found");
  }

  return tool;
}

describe("run_automation tool", () => {
  test("returns completed status and output on success", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        description: "Run once",
        name: "Manual task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "Hello from automation",
    } as never);
    const tool = getRunAutomationTool(service, runner);

    const result = await tool.run(
      { automationId: automation.id },
      TOOL_CONTEXT as never
    );

    expect(result).toEqual({
      automationId: automation.id,
      error: null,
      name: "Manual task",
      output: "Hello from automation",
      status: "completed",
    });
  });

  test("throws when automation is not found", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = getRunAutomationTool(service, runner);

    await expect(
      tool.run({ automationId: "automation_missing" }, TOOL_CONTEXT as never)
    ).rejects.toThrow("Automation not found.");
  });

  test("throws when automation is disabled", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        description: "Should not run",
        enabled: false,
        name: "Disabled task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = getRunAutomationTool(service, runner);

    await expect(
      tool.run({ automationId: automation.id }, TOOL_CONTEXT as never)
    ).rejects.toThrow("Automation is disabled.");
  });

  test("throws when automation is already running", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        description: "Already running",
        name: "Concurrent task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    let releaseFirstRun: (() => void) | undefined;
    let markFirstRunStarted: (() => void) | undefined;
    const firstRunHasStarted = new Promise<void>((resolve) => {
      markFirstRunStarted = resolve;
    });

    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => {
        markFirstRunStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve;
        });
        return "Done";
      },
    } as never);
    const tool = getRunAutomationTool(service, runner);

    const firstRun = tool.run(
      { automationId: automation.id },
      TOOL_CONTEXT as never
    );
    await firstRunHasStarted;

    await expect(
      tool.run({ automationId: automation.id }, TOOL_CONTEXT as never)
    ).rejects.toThrow("Automation is already running.");

    releaseFirstRun?.();
    await firstRun;
  });

  test("returns failed status when the run errors", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        description: "Provider offline",
        name: "Failing task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => {
        throw new Error("Provider offline");
      },
    } as never);
    const tool = getRunAutomationTool(service, runner);

    const result = await tool.run(
      { automationId: automation.id },
      TOOL_CONTEXT as never
    );

    expect(result).toEqual({
      automationId: automation.id,
      error: "Provider offline",
      name: "Failing task",
      output: null,
      status: "failed",
    });

    const runs = await service.listRuns(automation.id);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe("Provider offline");
  });
});

describe("list_previous_automation_runs tool", () => {
  test("returns previous runs for the current automation only", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        description: "Daily digest",
        name: "Digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );
    const otherAutomation = await service.create(
      ORG_ID,
      {
        description: "Other task",
        name: "Other",
        prompt: "Run",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    await db.insertAutomationRun({
      automationId: automation.id,
      completedAt: "2026-06-29T10:01:00.000Z",
      error: null,
      id: "run_previous",
      output: "Yesterday summary",
      startedAt: "2026-06-29T10:00:00.000Z",
      status: "completed",
    });
    await db.insertAutomationRun({
      automationId: automation.id,
      completedAt: null,
      error: null,
      id: "run_current",
      output: null,
      startedAt: "2026-06-30T10:00:00.000Z",
      status: "running",
    });
    await db.insertAutomationRun({
      automationId: otherAutomation.id,
      completedAt: "2026-06-30T09:01:00.000Z",
      error: null,
      id: "run_other",
      output: "Hidden",
      startedAt: "2026-06-30T09:00:00.000Z",
      status: "completed",
    });

    const tool = getPreviousAutomationRunsTool(service);
    const result = await tool.run({ limit: 5 }, {
      ...TOOL_CONTEXT,
      automationId: automation.id,
      automationRunId: "run_current",
    } as never);

    expect(result).toEqual([
      {
        completedAt: "2026-06-29T10:01:00.000Z",
        error: null,
        id: "run_previous",
        output: "Yesterday summary",
        startedAt: "2026-06-29T10:00:00.000Z",
        status: "completed",
      },
    ]);
  });

  test("requires current automation context", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const tool = getPreviousAutomationRunsTool(service);

    await expect(tool.run({}, TOOL_CONTEXT as never)).rejects.toThrow(
      "automationId is required."
    );
  });
});
