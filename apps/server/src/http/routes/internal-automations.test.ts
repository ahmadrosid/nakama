import { describe, expect, test } from "bun:test";
import { loadLocalAuthToken } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { AutomationService } from "../../services/automation-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import { seedLocalClientUser } from "../test-org-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

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

  // The auth middleware already 401s an unauthenticated caller, so the only thing
  // the route's local-token check does is keep a signed-in browser session out.
  test("keeps a browser session out of the internal automation endpoints", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const schedules = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules", {
        headers: session.headers(),
      })
    );
    expect(schedules.status).toBe(401);

    const run = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/automation_1/run?orgId=${session.orgId}`,
        {
          headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
          method: "POST",
        }
      )
    );
    expect(run.status).toBe(401);
  });

  test("runs automation via internal endpoint for the owning org", async () => {
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
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run?orgId=${ORG_ID}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(204);
  });

  test("rejects a run without an orgId assertion", async () => {
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

    expect(response.status).toBe(400);
  });

  test("refuses to run an automation under another org's id", async () => {
    const runCalls: string[] = [];
    const options = createServerOptions({
      agent: {
        providerConfigured: true,
        runAutomation: async (automationId: string) => {
          runCalls.push(automationId);
          return { skipped: false };
        },
      } as any,
    });
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const now = new Date().toISOString();
    await options.databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_other",
      name: "Other Org",
      slug: "other-org",
      updatedAt: now,
    });
    await options.databaseAdapter.upsertProfile({
      createdAt: now,
      id: "profile_other",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Other Bot",
      orgId: "org_other",
      systemPrompt: "",
      updatedAt: now,
    });
    const otherAutomation = await options.automationService.create(
      "org_other",
      {
        description: "Ping",
        name: "Hourly",
        prompt: "Ping",
        trigger: { cron: "0 * * * *", timezone: "UTC", type: "schedule" },
      },
      "profile_other"
    );

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(otherAutomation.id)}/run?orgId=${ORG_ID}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(404);
    expect(runCalls).toEqual([]);
  });

  test("returns 404 for unknown automation run", async () => {
    const options = createServerOptions();
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/unknown-automation/run?orgId=${ORG_ID}`,
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
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run?orgId=${ORG_ID}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(409);
  });

  test("omits automations on archived orgs from the schedule list", async () => {
    const options = createServerOptions();
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);
    const now = new Date().toISOString();
    await options.databaseAdapter.upsertOrganization({
      archivedAt: now,
      createdAt: now,
      id: ORG_ID,
      name: "Default Org",
      slug: "default-org",
      updatedAt: now,
    });

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

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  test("omits automations without an org from the schedule list", async () => {
    const options = createServerOptions();
    await seedOrgAndProfile(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

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

    const records = await options.databaseAdapter.listAutomations();
    await options.databaseAdapter.upsertAutomation({
      ...records[0]!,
      id: "automation_orgless",
      orgId: null,
    });

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/automations/schedules", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    const schedules = await response.json();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ orgId: ORG_ID });
  });

  test("does not run an automation for an archived org", async () => {
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
    const now = new Date().toISOString();
    await options.databaseAdapter.upsertOrganization({
      archivedAt: now,
      createdAt: now,
      id: ORG_ID,
      name: "Default Org",
      slug: "default-org",
      updatedAt: now,
    });

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/automations/${encodeURIComponent(automation.id)}/run?orgId=${ORG_ID}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(404);
  });
});
