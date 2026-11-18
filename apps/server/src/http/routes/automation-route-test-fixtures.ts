import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { AutomationService } from "../../services/automation-service";
import type { ManagedSecrets } from "../../services/managed-secrets";
import { OrgService } from "../../services/org-service";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedOrgForUser } from "../test-org-helpers";
import {
  type AppFetch,
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

export const PROFILE_ID = "profile_default";

const MEMBER_EMAIL = "member@example.com";

const MEMBER_PASSWORD = "password123";

export interface RouteTestFixture {
  app: ReturnType<typeof createMinimalHonoApp>["app"];
  authService: AuthService;
  automationService: AutomationService;
  databaseAdapter: DatabaseAdapter;
}

export function createFixture(
  options: {
    agent?: (automationService: AutomationService) => object;
    databaseAdapter?: DatabaseAdapter;
    secrets?: (databaseAdapter: DatabaseAdapter) => ManagedSecrets;
  } = {}
): RouteTestFixture {
  const databaseAdapter =
    options.databaseAdapter ?? createInMemoryDatabaseAdapter();

  const authService = new AuthService();
  const orgService = new OrgService(databaseAdapter, authService);

  const automationService = new AutomationService(databaseAdapter, {
    getUserTimezone: async () => "UTC",
    secrets: options.secrets?.(databaseAdapter),
  });

  const { app } = createMinimalHonoApp({
    agent: options.agent?.(automationService) ?? {
      providerConfigured: true,
      runAutomation: async () => ({}),
    },
    authService,
    automationService,
    databaseAdapter,
    orgService,
  });

  return {
    app,
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
export async function loginMember(fixture: RouteTestFixture) {
  // Hono's `fetch` is structurally narrower than the DOM `fetch` the shared
  // session helper declares; the runtime shape is identical.
  // SAFETY: This test controls the fixture shape at this boundary.
  const app = fixture.app as AppFetch;

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
