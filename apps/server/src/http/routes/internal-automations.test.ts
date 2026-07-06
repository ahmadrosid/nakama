import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { AutomationService } from "../../services/automation-service";
import { AutomationRunner } from "../../services/automation-runner";
import { loadLocalAuthToken } from "@nakama/core";
import { seedLocalClientUser } from "../test-org-helpers";

const PROFILE_ID = "profile_default";
const ORG_ID = "org_default";

function createServerOptions(overrides: Record<string, unknown> = {}) {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const orgService = new OrgService(databaseAdapter, authService);
  const agent = {
    providerConfigured: true,
    runAutomation: async (_automationId: string) => ({ skipped: false }),
  } as any;
  const automationService = new AutomationService(databaseAdapter, {
    getUserTimezone: async () => "UTC",
  });

  return {
    agent,
    automationService,
    taskService: {} as any,
    systemStatus: {} as any,
    workerManager: {} as any,
    mcpService: {} as any,
    authService,
    orgService,
    databaseAdapter,
    webDistDir: null,
    ...overrides,
  };
}

async function seedOrgAndProfile(db: ReturnType<typeof createInMemoryDatabaseAdapter>): Promise<void> {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    id: ORG_ID,
    name: "Default Org",
    slug: "default-org",
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
}

describe("internal automation routes", () => {
  test("lists scheduled automations for local-token auth", async () => {
    const options = createServerOptions();
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    await options.automationService.create(
      ORG_ID,
      {
        name: "Hourly",
        description: "Ping",
        prompt: "Ping",
        trigger: { type: "schedule", cron: "0 * * * *", timezone: "UTC" },
      },
      PROFILE_ID,
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(200);
    const schedules = await response.json();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      cron: "0 * * * *",
      timezone: "UTC",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    });
  });

  test("rejects schedule list without local-token auth", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules"),
    );

    expect(response.status).toBe(401);
  });

  test("runs automation via internal endpoint", async () => {
    const options = createServerOptions();
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const automation = await options.automationService.create(
      ORG_ID,
      {
        name: "Hourly",
        description: "Ping",
        prompt: "Ping",
        trigger: { type: "schedule", cron: "0 * * * *", timezone: "UTC" },
      },
      PROFILE_ID,
    );

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );

    expect(response.status).toBe(204);
  });

  test("returns 404 for unknown automation run", async () => {
    const options = createServerOptions();
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/internal/automations/unknown-automation/run",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );

    expect(response.status).toBe(404);
  });

  test("returns 409 when run is skipped", async () => {
    const options = createServerOptions({
      agent: {
        providerConfigured: true,
        runAutomation: async () => ({ skipped: true, error: "Already running" }),
      } as any,
    });
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const automation = await options.automationService.create(
      ORG_ID,
      {
        name: "Hourly",
        description: "Ping",
        prompt: "Ping",
        trigger: { type: "schedule", cron: "0 * * * *", timezone: "UTC" },
      },
      PROFILE_ID,
    );

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );

    expect(response.status).toBe(409);
  });
});
