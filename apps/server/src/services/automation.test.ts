import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AutomationDeliveryService } from "./automation-delivery-service";
import { AutomationRunner } from "./automation-runner";
import { AutomationService } from "./automation-service";
import {
  createMcpAwareEmailOutboundAdapter,
  hasAutomationEmailDeliveryPath,
} from "./mcp-email-delivery";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

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

async function assignComposeioGmailSender(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  profileId: string,
  inputSchema?: Record<string, unknown>
) {
  const now = new Date().toISOString();
  const serverId = "mcp_composeio";

  await db.upsertMcpServer({
    cachedTools: [
      {
        description: "Send an email with Gmail",
        inputSchema: inputSchema ?? {
          properties: {
            body: { type: "string" },
            subject: { type: "string" },
            to: { type: "string" },
          },
          type: "object",
        },
        name: "send_email",
      },
    ],
    config: { url: "https://example.com/mcp" },
    createdAt: now,
    enabled: true,
    id: serverId,
    lastError: null,
    name: "composeio-gmail",
    orgId: ORG_ID,
    status: "connected",
    transport: "http",
    updatedAt: now,
  });
  await db.assignMcpServerToProfile(profileId, serverId);
}

describe("AutomationService", () => {
  test("accepts email delivery when composeio MCP email sending is assigned", async () => {
    const db = await createTestDb();
    await assignComposeioGmailSender(db, PROFILE_ID);

    const service = new AutomationService(db, {
      canSendEmail: (profileId) =>
        hasAutomationEmailDeliveryPath(db, profileId, {
          loadConfig: async () => null,
        }),
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      {
        delivery: { channel: "email", to: "hey@ahmadrosid.com" },
        description: "Daily digest",
        name: "Digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    expect(automation.delivery).toEqual({
      channel: "email",
      to: "hey@ahmadrosid.com",
    });
  });

  test("defaults schedule timezone from user config", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "Asia/Jakarta",
    });

    const automation = await service.create(
      ORG_ID,
      {
        description: "Morning news",
        name: "HN digest",
        prompt: "Fetch Hacker News headlines",
        trigger: { cron: "0 8 * * *", type: "schedule" },
      },
      PROFILE_ID
    );

    expect(automation.trigger).toEqual({
      cron: "0 8 * * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
    expect(automation.nextRunAt).toBe(
      service.computeNextRunAt(automation.trigger, "Asia/Jakarta")
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
        description: "One-time",
        name: "Reminder",
        prompt: "Send reminder",
        trigger: { at, type: "runAt" },
      },
      PROFILE_ID
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
      createdAt: now,
      id: otherOrgId,
      name: "Other Org",
      slug: "other-org",
      updatedAt: now,
    });

    await db.upsertProfile({
      createdAt: now,
      id: otherProfileId,
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Other Bot",
      orgId: otherOrgId,
      systemPrompt: "",
      updatedAt: now,
    });

    const orgAutomation = await service.create(
      ORG_ID,
      {
        description: "Scoped",
        name: "Org task",
        prompt: "Run",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    await service.create(
      otherOrgId,
      {
        description: "Hidden",
        name: "Other org task",
        prompt: "Run",
        trigger: { type: "manual" },
      },
      otherProfileId
    );

    const listed = await service.listForOrg(ORG_ID);
    expect(listed.automations.map((entry) => entry.id)).toEqual([
      orgAutomation.id,
    ]);

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
        description: "Daily digest",
        name: "Digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    await db.insertAutomationRun({
      automationId: automation.id,
      completedAt: "2026-06-29T10:01:00.000Z",
      error: null,
      id: "run_unread_1",
      output: "Summary",
      startedAt: "2026-06-29T10:00:00.000Z",
      status: "completed",
    });

    const unread = await service.getUnreadSummary(ORG_ID, userId);
    expect(unread.totalUnread).toBe(1);
    expect(unread.byAutomationId[automation.id]).toBe(1);

    const runsBeforeRead = await service.listRuns(
      automation.id,
      ORG_ID,
      20,
      userId
    );
    expect(runsBeforeRead[0]?.read).toBe(false);

    await service.markRunsRead(automation.id, ORG_ID, userId);

    const unreadAfter = await service.getUnreadSummary(ORG_ID, userId);
    expect(unreadAfter.totalUnread).toBe(0);

    const runsAfterRead = await service.listRuns(
      automation.id,
      ORG_ID,
      20,
      userId
    );
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
        description: "Daily digest",
        name: "Digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    await db.insertAutomationRun({
      automationId: automation.id,
      completedAt: "2026-06-29T10:01:00.000Z",
      error: null,
      id: "run_delete_me",
      output: "Summary",
      startedAt: "2026-06-29T10:00:00.000Z",
      status: "completed",
    });

    await db.insertAutomationRun({
      automationId: automation.id,
      completedAt: "2026-06-29T11:01:00.000Z",
      error: null,
      id: "run_keep_me",
      output: "Another summary",
      startedAt: "2026-06-29T11:00:00.000Z",
      status: "completed",
    });

    await expect(
      service.deleteRun(automation.id, "run_delete_me", ORG_ID)
    ).resolves.toBe(true);
    await expect(
      service.deleteRun(automation.id, "run_missing", ORG_ID)
    ).resolves.toBe(false);

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
        description: "Run once",
        name: "Manual task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
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
        description: "Run with history scope",
        name: "Scoped task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
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
        automationRunId?: string
      ) => {
        received = { automationId, automationRunId, orgId, profileId, prompt };
        return "Hello from automation";
      },
    };

    const runner = new AutomationRunner(service, agentService as never);
    await runner.run(automation.id);

    const runs = await service.listRuns(automation.id);
    expect(received).toEqual({
      automationId: automation.id,
      automationRunId: runs[0]?.id,
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      prompt: "Say hello",
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
        description: "Run once",
        name: "Manual task",
        prompt: "Say hello",
        trigger: { type: "manual" },
      },
      PROFILE_ID
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

  test("maps Bun fetch disconnects to a readable run error", async () => {
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

    const agentService = {
      runAutomationPrompt: async () => {
        throw new Error(
          "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
        );
      },
    };

    const runner = new AutomationRunner(service, agentService as never);
    const result = await runner.run(automation.id);

    expect(result.error).toBe(
      "The connection closed before the agent finished. Restart the Nakama server, then try again. Long automations can take a minute or more."
    );

    const runs = await service.listRuns(automation.id);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe(result.error);
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
        description: "One-time",
        name: "Reminder",
        prompt: "Send reminder",
        trigger: { at, type: "runAt" },
      },
      PROFILE_ID
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
      createdAt: now,
      definition: {
        delivery: { channel: "telegram" },
        description: "Daily digest",
        prompt: "Summarize news",
        steps: [],
        trigger: { type: "manual" },
        version: 1,
      },
      enabled: true,
      id: "automation_delivery_test",
      name: "Digest",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      updatedAt: now,
      version: 1,
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
      deliveryService
    );
    await runner.run("automation_delivery_test");

    const runs = await service.listRuns("automation_delivery_test");
    expect(runs[0]?.deliveryStatus).toBe("sent");
  });

  test("delivers automation email through composeio MCP when SMTP is unavailable", async () => {
    const db = await createTestDb();
    await assignComposeioGmailSender(db, PROFILE_ID);

    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const now = new Date().toISOString();
    const sent: Record<string, unknown>[] = [];

    await db.upsertAutomation({
      createdAt: now,
      definition: {
        delivery: { channel: "email", to: "hey@ahmadrosid.com" },
        description: "Daily digest",
        prompt: "Summarize news",
        steps: [],
        trigger: { type: "manual" },
        version: 1,
      },
      enabled: true,
      id: "automation_email_delivery_test",
      name: "Digest",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      updatedAt: now,
      version: 1,
    });

    const manager = {
      callTool: async (
        _serverId: string,
        _transport: string,
        _toolName: string,
        input: unknown
      ) => {
        sent.push(input as Record<string, unknown>);
        return { ok: true };
      },
      connect: async () => [],
      ensureConnected: async () => undefined,
      isConnected: () => true,
    };

    const deliveryService = new AutomationDeliveryService(service, {
      email: createMcpAwareEmailOutboundAdapter(db, manager as never, {
        loadConfig: async () => null,
      }),
    });

    const agentService = {
      runAutomationPrompt: async () => "News summary",
    };

    const runner = new AutomationRunner(
      service,
      agentService as never,
      deliveryService
    );
    await runner.run("automation_email_delivery_test");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      body: expect.stringContaining("News summary"),
      subject: "[Nakama] Digest — completed",
      to: "hey@ahmadrosid.com",
    });

    const runs = await service.listRuns("automation_email_delivery_test");
    expect(runs[0]?.deliveryStatus).toBe("sent");
  });

  test("maps composeio-style schema aliases when calling MCP email tools", async () => {
    const db = await createTestDb();
    await assignComposeioGmailSender(db, PROFILE_ID, {
      properties: {
        message_body: { type: "string" },
        recipient_email: { type: "string" },
        title: { type: "string" },
      },
      type: "object",
    });

    const sent: Record<string, unknown>[] = [];
    const adapter = createMcpAwareEmailOutboundAdapter(
      db,
      {
        callTool: async (
          _serverId: string,
          _transport: string,
          _toolName: string,
          input: unknown
        ) => {
          sent.push(input as Record<string, unknown>);
          return { ok: true };
        },
        connect: async () => [],
        ensureConnected: async () => undefined,
        isConnected: () => true,
      } as never,
      { loadConfig: async () => null }
    );

    await adapter.send({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      subject: "Daily digest",
      text: "Hello world",
      to: "hey@ahmadrosid.com",
    });

    expect(sent).toEqual([
      {
        message_body: "Hello world",
        recipient_email: "hey@ahmadrosid.com",
        title: "Daily digest",
      },
    ]);
  });
});
