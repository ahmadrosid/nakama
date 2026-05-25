import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter, DEFAULT_PROFILE_ID } from "@tinyclaw/db";
import { AutomationService } from "./automation-service";
import { AutomationRunner } from "./automation-runner";

async function createTestDb() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  await db.upsertProfile({
    id: DEFAULT_PROFILE_ID,
    name: "Default Bot",
    systemPrompt: "",
    model: null,
    isSuper: false,
    createdAt: now,
    updatedAt: now,
  });

  return db;
}

describe("AutomationService", () => {
  test("defaults schedule timezone from user config", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "Asia/Jakarta",
    });

    const automation = await service.create(
      {
        name: "HN digest",
        description: "Morning news",
        prompt: "Fetch Hacker News headlines",
        trigger: { type: "schedule", cron: "0 8 * * *" },
      },
      "profile_default",
    );

    expect(automation.trigger).toEqual({
      type: "schedule",
      cron: "0 8 * * *",
      timezone: "Asia/Jakarta",
    });
    expect(automation.nextRunAt).toBeString();
  });
});

describe("AutomationRunner", () => {
  test("writes completed run records", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      {
        name: "Manual task",
        description: "Run once",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      "profile_default",
    );

    const agentService = {
      runAutomationPrompt: async () => "Hello from automation",
    };

    const runner = new AutomationRunner(service, agentService as never);
    const result = await runner.run(automation.id);

    expect(result.output).toBe("Hello from automation");

    const runs = await service.listRuns(automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.output).toBe("Hello from automation");
  });

  test("writes failed run records", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      {
        name: "Manual task",
        description: "Run once",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      "profile_default",
    );

    const agentService = {
      runAutomationPrompt: async () => {
        throw new Error("Provider offline");
      },
    };

    const runner = new AutomationRunner(service, agentService as never);
    const result = await runner.run(automation.id);

    expect(result.error).toBe("Provider offline");

    const runs = await service.listRuns(automation.id);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe("Provider offline");
  });
});
