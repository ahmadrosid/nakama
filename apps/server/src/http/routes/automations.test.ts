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
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { AutomationService } from "../../services/automation-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import { seedOrgForUser } from "../test-org-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

const PROFILE_ID = "profile_default";
const MEMBER_EMAIL = "member@example.com";
const MEMBER_PASSWORD = "password123";

interface RouteTestOptions {
  agent: unknown;
  authService: AuthService;
  automationService: AutomationService;
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>;
  mcpService: unknown;
  orgService: OrgService;
  systemStatus: unknown;
  webDistDir: null;
  workerManager: unknown;
}

function createServerOptions(): RouteTestOptions {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const orgService = new OrgService(databaseAdapter, authService);
  const automationService = new AutomationService(databaseAdapter, {
    getUserTimezone: async () => "UTC",
  });

  return {
    agent: { providerConfigured: true, runAutomation: async () => ({}) },
    authService,
    automationService,
    databaseAdapter,
    mcpService: {},
    orgService,
    systemStatus: {},
    webDistDir: null,
    workerManager: {},
  };
}

async function seedProfile(
  options: RouteTestOptions,
  orgId: string
): Promise<void> {
  const now = new Date().toISOString();
  await options.databaseAdapter.upsertProfile({
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
async function loginMember(
  options: RouteTestOptions,
  app: ReturnType<typeof createHonoApp>
) {
  const install = await setupFreshInstallSession(
    app,
    options.databaseAdapter,
    "owner@example.com"
  );
  const now = new Date().toISOString();
  await options.databaseAdapter.createUser({
    createdAt: now,
    email: MEMBER_EMAIL,
    id: "user_route_member",
    passwordHash: await options.authService.hashPassword(MEMBER_PASSWORD),
    updatedAt: now,
  });
  await seedOrgForUser(
    options.databaseAdapter,
    MEMBER_EMAIL,
    install.orgId,
    "member"
  );
  await seedProfile(options, install.orgId);

  return loginUserSession(app, MEMBER_EMAIL, MEMBER_PASSWORD, install.orgId);
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
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await loginMember(options, app);
    const configDir = await writeChannelConfigs(session.orgId);

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
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await loginMember(options, app);
    const configDir = await writeChannelConfigs(session.orgId);

    try {
      const created = await options.automationService.create(
        session.orgId,
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
