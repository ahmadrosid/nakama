import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { AutomationService } from "./automation-service";
import { AutomationRunner } from "./automation-runner";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

async function createTestDb() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  await db.upsertOrganization({
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    createdAt: now,
    updatedAt: now,
  });

  await db.upsertProfile({
    id: PROFILE_ID,
    name: "Default Bot",
    systemPrompt: "",
    model: null,
    isSuper: false,
    orgId: ORG_ID,
    isDefault: true,
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
      ORG_ID,
      {
        name: "HN digest",
        description: "Morning news",
        prompt: "Fetch Hacker News headlines",
        trigger: { type: "schedule", cron: "0 8 * * *" },
      },
      PROFILE_ID,
    );

    expect(automation.trigger).toEqual({
      type: "schedule",
      cron: "0 8 * * *",
      timezone: "Asia/Jakarta",
    });
    expect(automation.nextRunAt).toBe(
      service.computeNextRunAt(automation.trigger, "Asia/Jakarta"),
    );
  });

  test("computes nextRunAt for future runAt triggers", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "Asia/Jakarta",
    });
    const at = new Date(Date.now() + 60_000).toISOString();

    const automation = await service.create(
      ORG_ID,
      {
        name: "Reminder",
        description: "One-time",
        prompt: "Send reminder",
        trigger: { type: "runAt", at },
      },
      PROFILE_ID,
    );

    expect(automation.trigger.type).toBe("runAt");
    expect(automation.nextRunAt).toBe(new Date(at).toISOString());
  });

  test("lists automations only for the active org", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const now = new Date().toISOString();
    const otherOrgId = "org_other";
    const otherProfileId = "profile_other";

    await db.upsertOrganization({
      id: otherOrgId,
      name: "Other Org",
      slug: "other-org",
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertProfile({
      id: otherProfileId,
      name: "Other Bot",
      systemPrompt: "",
      model: null,
      isSuper: false,
      orgId: otherOrgId,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const orgAutomation = await service.create(
      ORG_ID,
      {
        name: "Org task",
        description: "Scoped",
        prompt: "Run",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
    );

    await service.create(
      otherOrgId,
      {
        name: "Other org task",
        description: "Hidden",
        prompt: "Run",
        trigger: { type: "manual" },
      },
      otherProfileId,
    );

    const listed = await service.listForOrg(ORG_ID);
    expect(listed.map((entry) => entry.id)).toEqual([orgAutomation.id]);

    expect(await service.get(orgAutomation.id, ORG_ID)).not.toBeNull();
    expect(await service.get(orgAutomation.id, otherOrgId)).toBeNull();
  });
});

describe("AutomationRunner", () => {
  test("writes completed run records", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        name: "Manual task",
        description: "Run once",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
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
      ORG_ID,
      {
        name: "Manual task",
        description: "Run once",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
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

  test("disables runAt automations before executing", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const at = new Date(Date.now() + 60_000).toISOString();

    const automation = await service.create(
      ORG_ID,
      {
        name: "Reminder",
        description: "One-time",
        prompt: "Send reminder",
        trigger: { type: "runAt", at },
      },
      PROFILE_ID,
    );

    const agentService = {
      runAutomationPrompt: async () => "Reminder sent",
    };

    const runner = new AutomationRunner(service, agentService as never);
    const result = await runner.run(automation.id);

    expect(result.output).toBe("Reminder sent");

    const updated = await service.get(automation.id, ORG_ID);
    expect(updated?.enabled).toBe(false);
    expect(updated?.nextRunAt).toBeNull();
  });
});
