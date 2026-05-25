import { describe, test } from "bun:test";
import { createInMemoryDatabaseAdapter, DEFAULT_PROFILE_ID } from "@tinyclaw/db";
import { AutomationScheduler } from "./automation-scheduler";
import { AutomationService } from "./automation-service";
import { AutomationRunner } from "./automation-runner";

describe("AutomationScheduler", () => {
  test("reload registers jobs for enabled scheduled automations", async () => {
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
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      {
        name: "Hourly",
        description: "Ping",
        prompt: "Ping",
        trigger: { type: "schedule", cron: "0 * * * *", timezone: "UTC" },
      },
      "profile_default",
    );

    const runner = {
      run: async () => ({ output: "ok" }),
    };

    const scheduler = new AutomationScheduler(
      service,
      runner as unknown as AutomationRunner,
      async () => "UTC",
    );

    await scheduler.start();
    await scheduler.reload();
    await service.update(automation.id, { enabled: false });
    await scheduler.reload();
    scheduler.stop();
  });
});
