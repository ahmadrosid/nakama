import { describe, expect, test } from "bun:test";
import { loadLocalAuthToken } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { AutomationService } from "../../services/automation-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
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
    authService,
    automationService,
    databaseAdapter,
    mcpService: {} as any,
    orgService,
    systemStatus: {} as any,
    taskService: {} as any,
    webDistDir: null,
    workerManager: {} as any,
    ...overrides,
  };
}

async function seedOrgAndProfile(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
): Promise<void> {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Default Org",
    slug: "default-org",
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
        description: "Ping",
        name: "Hourly",
        prompt: "Ping",
        trigger: { cron: "0 * * * *", timezone: "UTC", type: "schedule" },
      },
      PROFILE_ID
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    const schedules = await response.json();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      cron: "0 * * * *",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      timezone: "UTC",
    });
  });

  test("rejects schedule list without local-token auth", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules")
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
        description: "Ping",
        name: "Hourly",
        prompt: "Ping",
        trigger: { cron: "0 * * * *", timezone: "UTC", type: "schedule" },
      },
      PROFILE_ID
    );

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
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
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(404);
  });

  test("returns 409 when run is skipped", async () => {
    const options = createServerOptions({
      agent: {
        providerConfigured: true,
        runAutomation: async () => ({
          error: "Already running",
          skipped: true,
        }),
      } as any,
    });
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const automation = await options.automationService.create(
      ORG_ID,
      {
        description: "Ping",
        name: "Hourly",
        prompt: "Ping",
        trigger: { cron: "0 * * * *", timezone: "UTC", type: "schedule" },
      },
      PROFILE_ID
    );

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(409);
  });
});
