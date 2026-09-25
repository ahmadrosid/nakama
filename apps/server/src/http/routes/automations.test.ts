import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDiscordConfigDir,
  getDiscordConfigPath,
  getTelegramConfigDir,
  getTelegramConfigPath,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { AutomationService } from "../../services/automation-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import type { ServerOptions } from "../context";
import { seedOrgForUser } from "../test-org-helpers";
import {
  type AppFetch,
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

const PROFILE_ID = "profile_default";
const MEMBER_EMAIL = "member@example.com";
const MEMBER_PASSWORD = "password123";

interface RouteTestFixture {
  app: ReturnType<typeof createHonoApp>;
  authService: AuthService;
  automationService: AutomationService;
  databaseAdapter: DatabaseAdapter;
}

function createFixture(): RouteTestFixture {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const orgService = new OrgService(databaseAdapter, authService);
  const automationService = new AutomationService(databaseAdapter, {
    getUserTimezone: async () => "UTC",
  });
  // Only the automation surface is exercised; the remaining collaborators are
  // unreachable stubs, so they are cast once instead of fully constructed.
  const options = {
    agent: { providerConfigured: true, runAutomation: async () => ({}) },
    authService,
    automationService,
    databaseAdapter,
    mcpService: {},
    orgService,
    systemStatus: {},
    webDistDir: null,
    workerManager: {},
  } as unknown as ServerOptions;

  return {
    app: createHonoApp(options),
    authService,
    automationService,
    databaseAdapter,
  };
}

async function seedProfile(
  fixture: RouteTestFixture,
  orgId: string
): Promise<void> {
  const now = new Date().toISOString();
  await fixture.databaseAdapter.upsertProfile({
    createdAt: now,
    id: PROFILE_ID,
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default Bot",
    orgId,
    systemPrompt: "",
    updatedAt: now,
  });
}

/** A real signed-in member: the install owner is always an org admin. */
async function loginMember(fixture: RouteTestFixture) {
  // Hono's `fetch` is structurally narrower than the DOM `fetch` the shared
  // session helper declares; the runtime shape is identical.
  const app = fixture.app as unknown as AppFetch;
  const install = await setupFreshInstallSession(
    app,
    fixture.databaseAdapter,
    "owner@example.com"
  );

  if (!install.orgId) {
    throw new Error("Install session did not return an org.");
  }

  const now = new Date().toISOString();
  await fixture.databaseAdapter.createUser({
    createdAt: now,
    email: MEMBER_EMAIL,
    id: "user_route_member",
    passwordHash: await fixture.authService.hashPassword(MEMBER_PASSWORD),
    updatedAt: now,
  });
  await seedOrgForUser(
    fixture.databaseAdapter,
    MEMBER_EMAIL,
    install.orgId,
    "member"
  );
  await seedProfile(fixture, install.orgId);

  const session = await loginUserSession(
    app,
    MEMBER_EMAIL,
    MEMBER_PASSWORD,
    install.orgId
  );

  return { orgId: install.orgId, session };
}

async function writeChannelConfigs(orgId: string): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-automation-route-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  const owner = { orgId, profileId: PROFILE_ID };

  await mkdir(getTelegramConfigDir(owner), { recursive: true });
  await writeFile(
    getTelegramConfigPath(owner),
    "bot_token=test-token\npaired_user_ids=111\n",
    "utf8"
  );
  await mkdir(getDiscordConfigDir(owner), { recursive: true });
  await writeFile(
    getDiscordConfigPath(owner),
    "bot_token=test-token\npaired_user_ids=123456789012345678\n",
    "utf8"
  );

  return configDir;
}

function automationBody(delivery: unknown): string {
  return JSON.stringify({
    delivery,
    description: "Report",
    name: "Report",
    profileId: PROFILE_ID,
    prompt: "Summarize the week",
    trigger: { type: "manual" },
  });
}

describe("automation destination authorization over HTTP", () => {
  test("a member cannot create an automation aimed at a foreign destination", async () => {
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);
    const app = fixture.app;
    const configDir = await writeChannelConfigs(orgId);

    try {
      for (const delivery of [
        { channel: "telegram", chatId: 999 },
        { channel: "discord", channelId: "123456789012345679" },
      ]) {
        const response = await app.fetch(
          new Request("http://localhost:4310/v1/automations", {
            body: automationBody(delivery),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              ...session.headers(),
            },
            method: "POST",
          })
        );

        expect(response.status).toBe(403);
        expect(((await response.json()) as { error: string }).error).toContain(
          "organization admin"
        );
      }

      const paired = await app.fetch(
        new Request("http://localhost:4310/v1/automations", {
          body: automationBody({ channel: "telegram", chatId: 111 }),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "POST",
        })
      );

      expect(paired.status).toBe(201);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("a member cannot repoint an existing automation at a new destination", async () => {
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);
    const app = fixture.app;
    const configDir = await writeChannelConfigs(orgId);

    try {
      const created = await fixture.automationService.create(
        orgId,
        {
          delivery: { channel: "telegram", chatId: 111 },
          description: "Report",
          name: "Report",
          prompt: "Summarize the week",
          trigger: { type: "manual" },
        },
        PROFILE_ID,
        { isPlatformAdmin: false, orgRole: "admin" }
      );

      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/automations/${created.id}`, {
          body: JSON.stringify({
            delivery: { channel: "telegram", chatId: 999 },
          }),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "PUT",
        })
      );

      expect(response.status).toBe(403);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { force: true, recursive: true });
    }
  });
});
