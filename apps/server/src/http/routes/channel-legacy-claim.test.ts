import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-channel-legacy-claim-test-");

const ORG_ID = "org_channel_legacy";

const PASSWORD = "password123";

const PROFILE_ID = "default";

// `global: true` claims the install-wide connection, which carries the bot
// token and the allowed-chat list. `claimLegacyChannel` has no role check of
// its own, so the route decides this on its own. The recorded scope is the
// assertion that matters: null is the install-wide source.
function createApp() {
  const claimedScopes: (string | null)[] = [];
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const { app, authService } = createMinimalHonoApp({
    agent: {
      getProfile: async (_orgId: string, profileId: string) => ({
        profile: { id: profileId, isSuper: false },
      }),
    },
    databaseAdapter,
    workerManager: {
      claimLegacyChannel: async (
        _platform: string,
        scope: string | null
      ): Promise<void> => {
        claimedScopes.push(scope);
      },
      legacyChannels: async () => [],
    },
  });

  return { app, authService, claimedScopes, databaseAdapter };
}

async function login(role: OrgRole, isPlatformAdmin = false) {
  const { app, authService, claimedScopes, databaseAdapter } = createApp();
  const suffix = isPlatformAdmin ? "_platform" : "";
  const email = `${role}${suffix}@example.com`;
  const userId = `user_${role}${suffix}`;

  // The organization needs an owner regardless; the user under test is seeded
  // separately so it can carry an arbitrary role and the platform-admin flag.
  await seedOrgAdmin(databaseAdapter, {
    authService,
    email: "owner@example.com",
    orgId: ORG_ID,
    password: PASSWORD,
    userId: "user_owner",
  });

  const now = new Date().toISOString();

  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id: userId,
    isPlatformAdmin,
    passwordHash: await authService.hashPassword(PASSWORD),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId: ORG_ID,
    role,
    userId,
  });

  const session = await loginUserSession(app, email, PASSWORD, ORG_ID);

  return { app, claimedScopes, session };
}

function claim(
  app: { fetch: typeof fetch },
  session: {
    headers: (extra?: Record<string, string>) => Record<string, string>;
    csrfToken: string;
  },
  body: { platform: string; global?: boolean }
) {
  return app.fetch(
    new Request(
      `http://localhost:4310/v1/settings/channel-legacy/claim?profileId=${PROFILE_ID}`,
      {
        body: JSON.stringify(body),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      }
    )
  );
}

describe("legacy channel claim", () => {
  test("an organization admin cannot claim the install-wide connection", async () => {
    const { app, claimedScopes, session } = await login("admin");

    const response = await claim(app, session, {
      global: true,
      platform: "telegram",
    });

    expect(response.status).toBe(403);
    expect(claimedScopes).toEqual([]);
  });

  test("an organization admin claims their own organization's connection", async () => {
    const { app, claimedScopes, session } = await login("admin");
    const response = await claim(app, session, { platform: "telegram" });

    expect(response.status).toBe(200);
    expect(claimedScopes).toEqual([ORG_ID]);
  });

  test("a platform admin claims the install-wide connection", async () => {
    const { app, claimedScopes, session } = await login("admin", true);

    const response = await claim(app, session, {
      global: true,
      platform: "telegram",
    });

    expect(response.status).toBe(200);
    expect(claimedScopes).toEqual([null]);
  });

  test("a member cannot claim any connection", async () => {
    const { app, claimedScopes, session } = await login("member");
    const response = await claim(app, session, { platform: "telegram" });

    expect(response.status).toBe(403);
    expect(claimedScopes).toEqual([]);
  });
});
