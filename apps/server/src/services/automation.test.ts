import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { AutomationService } from "./automation-service";
import { AutomationRunner } from "./automation-runner";
import { AutomationDeliveryService } from "./automation-delivery-service";

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
    expect(listed.automations.map((entry) => entry.id)).toEqual([orgAutomation.id]);

    expect(await service.get(orgAutomation.id, ORG_ID)).not.toBeNull();
    expect(await service.get(orgAutomation.id, otherOrgId)).toBeNull();
  });

  test("tracks unread runs per user and marks them read", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const userId = "user_test";

    const automation = await service.create(
      ORG_ID,
      {
        name: "Digest",
        description: "Daily digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
    );

    await db.insertAutomationRun({
      id: "run_unread_1",
      automationId: automation.id,
      status: "completed",
      startedAt: "2026-06-29T10:00:00.000Z",
      completedAt: "2026-06-29T10:01:00.000Z",
      output: "Summary",
      error: null,
    });

    const unread = await service.getUnreadSummary(ORG_ID, userId);
    expect(unread.totalUnread).toBe(1);
    expect(unread.byAutomationId[automation.id]).toBe(1);

    const runsBeforeRead = await service.listRuns(automation.id, ORG_ID, 20, userId);
    expect(runsBeforeRead[0]?.read).toBe(false);

    await service.markRunsRead(automation.id, ORG_ID, userId);

    const unreadAfter = await service.getUnreadSummary(ORG_ID, userId);
    expect(unreadAfter.totalUnread).toBe(0);

    const runsAfterRead = await service.listRuns(automation.id, ORG_ID, 20, userId);
    expect(runsAfterRead[0]?.read).toBe(true);
  });

  test("deletes a run history item", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        name: "Digest",
        description: "Daily digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
    );

    await db.insertAutomationRun({
      id: "run_delete_me",
      automationId: automation.id,
      status: "completed",
      startedAt: "2026-06-29T10:00:00.000Z",
      completedAt: "2026-06-29T10:01:00.000Z",
      output: "Summary",
      error: null,
    });

    await db.insertAutomationRun({
      id: "run_keep_me",
      automationId: automation.id,
      status: "completed",
      startedAt: "2026-06-29T11:00:00.000Z",
      completedAt: "2026-06-29T11:01:00.000Z",
      output: "Another summary",
      error: null,
    });

    await expect(service.deleteRun(automation.id, "run_delete_me", ORG_ID)).resolves.toBe(true);
    await expect(service.deleteRun(automation.id, "run_missing", ORG_ID)).resolves.toBe(false);

    const runs = await service.listRuns(automation.id, ORG_ID);
    expect(runs.map((run) => run.id)).toEqual(["run_keep_me"]);
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

  test("passes automation scope to the agent prompt", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        name: "Scoped task",
        description: "Run with history scope",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
    );

    let received:
      | {
          orgId: string;
          profileId: string;
          prompt: string;
          automationId?: string;
          automationRunId?: string;
        }
      | undefined;

    const agentService = {
      runAutomationPrompt: async (
        orgId: string,
        profileId: string,
        prompt: string,
        automationId?: string,
        automationRunId?: string,
      ) => {
        received = { orgId, profileId, prompt, automationId, automationRunId };
        return "Hello from automation";
      },
    };

    const runner = new AutomationRunner(service, agentService as never);
    await runner.run(automation.id);

    const runs = await service.listRuns(automation.id);
    expect(received).toEqual({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      prompt: "Say hello",
      automationId: automation.id,
      automationRunId: runs[0]?.id,
    });
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

  test("records delivery status after successful runs", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const now = new Date().toISOString();
    await db.upsertAutomation({
      id: "automation_delivery_test",
      name: "Digest",
      version: 1,
      definition: {
        description: "Daily digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
        steps: [],
        version: 1,
        delivery: { channel: "telegram" },
      },
      profileId: PROFILE_ID,
      orgId: ORG_ID,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const agentService = {
      runAutomationPrompt: async () => "News summary",
    };

    const deliveryService = new AutomationDeliveryService(service, {
      telegram: {
        send: async () => ({ ok: true }),
      },
    });

    const runner = new AutomationRunner(
      service,
      agentService as never,
      deliveryService,
    );
    await runner.run("automation_delivery_test");

    const runs = await service.listRuns("automation_delivery_test");
    expect(runs[0]?.deliveryStatus).toBe("sent");
  });
});
