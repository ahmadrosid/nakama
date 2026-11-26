import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profiles-skills-write-approval-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);

  return {
    ...createMinimalHonoApp({
      agent: {
        getProfileAccess: (orgId: string, profileId: string) =>
          new AgentService(null, null, databaseAdapter).getProfileAccess(
            orgId,
            profileId
          ),
        updateProfile: (
          orgId: string,
          profileId: string,
          body: Parameters<ProfileService["updateProfile"]>[2]
        ) => profileService.updateProfile(orgId, profileId, body),
      },
      databaseAdapter,
    }),
    profileService,
  };
}

const BASE = "http://localhost:4310";

describe("profile skillsWriteApproval auth", () => {
  test("org admin can patch skillsWriteApproval only; other fields forbidden", async () => {
    const { app, databaseAdapter } = createApp();

    const platformSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "platform@org.com"
    );

    const orgId = platformSession.orgId!;

    const inviteResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "orgadmin@org.com",
          name: "Org Admin",
          role: "admin",
        }),
        headers: platformSession.headers(
          { "X-CSRF-Token": platformSession.csrfToken },
          orgId
        ),
        method: "POST",
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const invited = (await inviteResp.json()) as { temporaryPassword: string };

    const orgAdminSession = await loginUserSession(
      app,
      "orgadmin@org.com",
      invited.temporaryPassword,
      orgId
    );

    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const okResp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        body: JSON.stringify({ skillsWriteApproval: true }),
        headers: orgAdminSession.headers(
          { "X-CSRF-Token": orgAdminSession.csrfToken },
          orgId
        ),
        method: "PUT",
      })
    );

    expect(okResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const okBody = (await okResp.json()) as {
      profile: { skillsWriteApproval: boolean | null };
    };

    expect(okBody.profile.skillsWriteApproval).toBe(true);

    const reviewResp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        body: JSON.stringify({ skillsPostTurnReview: true }),
        headers: orgAdminSession.headers(
          { "X-CSRF-Token": orgAdminSession.csrfToken },
          orgId
        ),
        method: "PUT",
      })
    );

    expect(reviewResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const reviewBody = (await reviewResp.json()) as {
      profile: { skillsPostTurnReview: boolean | null };
    };

    expect(reviewBody.profile.skillsPostTurnReview).toBe(true);

    const putSetting = (body: { platformToolsEnabled: boolean | string }) =>
      app.fetch(
        new Request(`${BASE}/v1/profiles/${profileId}`, {
          body: JSON.stringify(body),
          headers: orgAdminSession.headers(
            { "X-CSRF-Token": orgAdminSession.csrfToken },
            orgId
          ),
          method: "PUT",
        })
      );

    const platformResp = await putSetting({ platformToolsEnabled: false });

    expect(platformResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const platformBody = (await platformResp.json()) as {
      profile: { platformToolsEnabled: boolean };
    };

    expect(platformBody.profile.platformToolsEnabled).toBe(false);
    expect(
      (await databaseAdapter.getProfile(profileId))?.platformToolsEnabled
    ).toBe(false);

    // A string "true" must not turn the tools back on.
    expect((await putSetting({ platformToolsEnabled: "true" })).status).toBe(
      400
    );
    expect(
      (await databaseAdapter.getProfile(profileId))?.platformToolsEnabled
    ).toBe(false);

    const forbiddenResp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        body: JSON.stringify({ name: "Renamed", skillsWriteApproval: false }),
        headers: orgAdminSession.headers(
          { "X-CSRF-Token": orgAdminSession.csrfToken },
          orgId
        ),
        method: "PUT",
      })
    );

    expect(forbiddenResp.status).toBe(403);
  });
});
