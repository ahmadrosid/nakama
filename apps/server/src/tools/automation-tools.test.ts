import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDiscordConfigDir, getDiscordConfigPath } from "@nakama/core";
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

describe("create_automation tool", () => {
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }
  });

  test("defaults profileId to the chat session profile", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = createAutomationTools(service, runner).find(
      (entry) => entry.name === "create_automation"
    );

    if (!tool) {
      throw new Error("create_automation tool not found");
    }

    const created = (await tool.run(
      {
        description: "Digest",
        name: "Session digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      { ...TOOL_CONTEXT, orgRole: "member" } as never
    )) as { id: string; profileId: string };

    expect(created.profileId).toBe(PROFILE_ID);
    expect((await service.get(created.id, ORG_ID))?.profileId).toBe(PROFILE_ID);
  });

  test("treats blank profileId as the session profile", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = createAutomationTools(service, runner).find(
      (entry) => entry.name === "create_automation"
    );

    if (!tool) {
      throw new Error("create_automation tool not found");
    }

    const created = (await tool.run(
      {
        description: "Digest",
        name: "Blank profile",
        profileId: "   ",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      { ...TOOL_CONTEXT, orgRole: "member" } as never
    )) as { profileId: string };

    expect(created.profileId).toBe(PROFILE_ID);
  });

  test("binds an explicit non-super profileId", async () => {
    const db = await createTestDb();
    const now = new Date().toISOString();
    const otherId = "profile_other";
    await db.upsertProfile({
      createdAt: now,
      id: otherId,
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Other Bot",
      orgId: ORG_ID,
      systemPrompt: "",
      updatedAt: now,
    });

    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = createAutomationTools(service, runner).find(
      (entry) => entry.name === "create_automation"
    );

    if (!tool) {
      throw new Error("create_automation tool not found");
    }

    const created = (await tool.run(
      {
        description: "Digest",
        name: "Other digest",
        profileId: otherId,
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      { ...TOOL_CONTEXT, orgRole: "member" } as never
    )) as { profileId: string };

    expect(created.profileId).toBe(otherId);
  });

  test("denies Super Bot profileId for members", async () => {
    const db = await createTestDb();
    const now = new Date().toISOString();
    const superId = "profile_super";
    await db.upsertProfile({
      createdAt: now,
      id: superId,
      isDefault: false,
      isSuper: true,
      model: null,
      name: "Super Bot",
      orgId: ORG_ID,
      systemPrompt: "",
      updatedAt: now,
    });

    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = createAutomationTools(service, runner).find(
      (entry) => entry.name === "create_automation"
    );

    if (!tool) {
      throw new Error("create_automation tool not found");
    }

    await expect(
      tool.run(
        {
          description: "Digest",
          name: "Super digest",
          profileId: superId,
          prompt: "Summarize news",
          trigger: { type: "manual" },
        },
        { ...TOOL_CONTEXT, orgRole: "member" } as never
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  test("list_automations includes profileId", async () => {
    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    await service.create(
      ORG_ID,
      {
        description: "Digest",
        name: "Digest",
        prompt: "Summarize",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = createAutomationTools(service, runner).find(
      (entry) => entry.name === "list_automations"
    );

    if (!tool) {
      throw new Error("list_automations tool not found");
    }

    const listed = (await tool.run({}, TOOL_CONTEXT as never)) as Array<{
      profileId: string;
    }>;
    expect(listed[0]?.profileId).toBe(PROFILE_ID);
  });

  test("persists discord delivery and optional channelId", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-discord-tool-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(getDiscordConfigDir(), { recursive: true });
    await writeFile(
      getDiscordConfigPath(),
      "bot_token=test-token\npaired_user_ids=123456789012345678\n",
      "utf8"
    );

    const db = await createTestDb();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });
    const runner = new AutomationRunner(service, {
      runAutomationPrompt: async () => "unused",
    } as never);
    const tool = createAutomationTools(service, runner).find(
      (entry) => entry.name === "create_automation"
    );

    if (!tool) {
      throw new Error("create_automation tool not found");
    }

    const created = (await tool.run(
      {
        delivery: { channel: "discord" },
        description: "Digest",
        name: "Discord digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      TOOL_CONTEXT as never
    )) as { delivery: unknown; id: string };

    expect(created.delivery).toEqual({ channel: "discord" });

    const withChannel = (await tool.run(
      {
        delivery: {
          channel: "discord",
          channelId: "987654321098765432",
        },
        description: "Channel digest",
        name: "Discord channel digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      },
      TOOL_CONTEXT as never
    )) as { delivery: unknown };

    expect(withChannel.delivery).toEqual({
      channel: "discord",
      channelId: "987654321098765432",
    });

    await rm(configDir, { force: true, recursive: true });
  });
});
