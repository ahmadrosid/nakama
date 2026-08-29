import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profile-history-routes-");

const BASE = "http://localhost:4310";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
        getProfile: (orgId: string, profileId: string) =>
          profileService.getProfile(orgId, profileId),
        listProfileChangeHistory: (
          orgId: string,
          profileId: string,
          options?: { limit?: number; offset?: number }
        ) => profileService.listProfileChangeHistory(orgId, profileId, options),
        listProfiles: (orgId: string) => profileService.listProfiles(orgId),
        updateProfile: (
          orgId: string,
          profileId: string,
          request: unknown,
          meta?: unknown
        ) =>
          profileService.updateProfile(
            orgId,
            profileId,
            request as { systemPrompt?: string },
            meta as
              | { actorUserId?: string | null; source: "dashboard" }
              | undefined
          ),
      },
      databaseAdapter,
    }),
    databaseAdapter,
    profileService,
  };
}

describe("GET /v1/profiles/:profileId/history", () => {
  test("org admin can read history; viewer gets 403", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const platform = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "history-admin@example.com"
    );
    const orgId = platform.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;

    await profileService.updateProfile(
      orgId,
      profileId,
      { systemPrompt: "changed by admin" },
      { actorUserId: "user_platform", source: "dashboard" }
    );

    const allowed = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}/history`, {
        headers: platform.headers({}, orgId),
      })
    );
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as {
      events: Array<{ field: string; source: string }>;
    };
    expect(body.events.some((event) => event.field === "system_prompt")).toBe(
      true
    );

    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "viewer-history@example.com",
      id: "user_viewer_history",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "viewer",
      userId: "user_viewer_history",
    });

    const viewer = await loginUserSession(
      app,
      "viewer-history@example.com",
      "password123",
      orgId
    );

    const denied = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}/history`, {
        headers: viewer.headers({}, orgId),
      })
    );
    expect(denied.status).toBe(403);
  }, 20_000);
});
