import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profiles-clone-routes-");

const BASE = "http://localhost:4310";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
        cloneProfile: (orgId: string, sourceId: string, request: unknown) =>
          profileService.cloneProfile(
            orgId,
            sourceId,
            request as { id?: string; name?: string }
          ),
        listProfiles: async () => ({ profiles: [] }),
      },
      databaseAdapter,
    }),
    databaseAdapter,
  };
}

describe("POST /v1/profiles/:profileId/clone", () => {
  test("an org admin who is not a platform admin gets 403", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "platform@example.com"
    );
    const orgId = platformSession.orgId!;
    const [source] = await databaseAdapter.listProfilesForOrg(orgId);
    const now = new Date().toISOString();

    await databaseAdapter.createUser({
      createdAt: now,
      email: "org-admin-clone@example.com",
      id: "user_org_admin_clone",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "admin",
      userId: "user_org_admin_clone",
    });

    const countBefore = (await databaseAdapter.listProfilesForOrg(orgId))
      .length;

    const orgAdmin = await loginUserSession(
      app,
      "org-admin-clone@example.com",
      "password123",
      orgId
    );

    const denied = await app.fetch(
      new Request(`${BASE}/v1/profiles/${source!.id}/clone`, {
        body: "{}",
        headers: orgAdmin.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": orgAdmin.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(denied.status).toBe(403);
    // The refusal must happen before anything is written.
    expect(await databaseAdapter.listProfilesForOrg(orgId)).toHaveLength(
      countBefore
    );
  }, 20_000);

  test("a platform admin gets 201 and a new profile", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "platform2@example.com"
    );
    const orgId = session.orgId!;
    const before = await databaseAdapter.listProfilesForOrg(orgId);
    const source = before.find((profile) => !profile.isSuper);

    const response = await app.fetch(
      new Request(`${BASE}/v1/profiles/${source!.id}/clone`, {
        body: "{}",
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
    expect(await databaseAdapter.listProfilesForOrg(orgId)).toHaveLength(
      before.length + 1
    );
  }, 20_000);

  test("malformed JSON returns 400 without cloning a profile", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "platform3@example.com"
    );
    const orgId = session.orgId!;
    const before = await databaseAdapter.listProfilesForOrg(orgId);
    const source = before.find((profile) => !profile.isSuper);

    const response = await app.fetch(
      new Request(`${BASE}/v1/profiles/${source!.id}/clone`, {
        body: "{",
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(await databaseAdapter.listProfilesForOrg(orgId)).toHaveLength(
      before.length
    );
  }, 20_000);

  test("an empty body keeps the optional clone defaults", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "platform4@example.com"
    );
    const orgId = session.orgId!;
    const before = await databaseAdapter.listProfilesForOrg(orgId);
    const source = before.find((profile) => !profile.isSuper);

    const response = await app.fetch(
      new Request(`${BASE}/v1/profiles/${source!.id}/clone`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }, orgId),
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
    expect(await databaseAdapter.listProfilesForOrg(orgId)).toHaveLength(
      before.length + 1
    );
  }, 20_000);
});
