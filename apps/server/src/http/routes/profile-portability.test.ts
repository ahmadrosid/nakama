import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import type { AuthService } from "../../services/auth-service";
import { PROFILE_PACK_KIND } from "../../services/profile-portability";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profile-pack-routes-");

const BASE = "http://localhost:4310";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
        createProfile: (orgId: string, request: unknown) =>
          profileService.createProfile(
            orgId,
            request as { name: string; isSuper?: boolean }
          ),
        listProfiles: async (orgId: string) => ({
          profiles: await databaseAdapter.listProfilesForOrg(orgId),
        }),
      },
      databaseAdapter,
    }),
    databaseAdapter,
    profileService,
  };
}

async function createOrgAdminSession(
  app: ReturnType<typeof createApp>["app"],
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  slug: string,
  email: string
) {
  const platformSession = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const createResponse = await app.fetch(
    new Request(`${BASE}/v1/platform/orgs`, {
      body: JSON.stringify({
        admin: {
          email,
          name: "Pack Admin",
          phone: "+628123456789",
        },
        name: "Pack Org",
        slug,
      }),
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      method: "POST",
    })
  );

  expect(createResponse.status).toBe(201);
  const created = (await createResponse.json()) as {
    organization: { id: string };
    adminMember: { temporaryPassword: string };
  };

  return {
    adminSession: await loginUserSession(
      app,
      email,
      created.adminMember.temporaryPassword,
      created.organization.id
    ),
    orgId: created.organization.id,
    platformSession,
  };
}

describe("profile pack routes", () => {
  test("org admin can export and import a profile pack", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-export",
      "pack-admin@example.com"
    );

    const created = await profileService.createProfile(orgId, {
      name: "Packable Bot",
      systemPrompt: "help",
    });

    const exportResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/${created.profile.id}/pack/export`, {
        headers: adminSession.headers({}, orgId),
      })
    );

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toBe("application/zip");
    expect(exportResponse.headers.get("content-disposition")).toContain(
      "nakama-profile-export-"
    );

    const archive = Buffer.from(await exportResponse.arrayBuffer());

    const previewResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/pack/import/preview`, {
        body: JSON.stringify({ data: archive.toString("base64") }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      manifest: { kind: string };
      plannedName: string;
    };
    expect(preview.manifest.kind).toBe(PROFILE_PACK_KIND);
    expect(preview.plannedName).toBe("Packable Bot");

    const countBefore = (await databaseAdapter.listProfilesForOrg(orgId))
      .length;

    const importResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/pack/import`, {
        body: JSON.stringify({
          confirm: true,
          data: archive.toString("base64"),
          name: "Packable Bot (imported)",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(importResponse.status).toBe(200);
    const imported = (await importResponse.json()) as { profileId: string };
    expect(imported.profileId).toBeTruthy();
    expect(await databaseAdapter.listProfilesForOrg(orgId)).toHaveLength(
      countBefore + 1
    );
  }, 30_000);

  test("member cannot export or import a profile pack", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const { orgId } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-member",
      "pack-owner@example.com"
    );

    const created = await profileService.createProfile(orgId, {
      name: "Member Blocked",
    });

    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "pack-member-direct@example.com",
      id: "user_pack_member",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: "user_pack_member",
    });
    const memberSession = await loginUserSession(
      app,
      "pack-member-direct@example.com",
      "password123",
      orgId
    );

    const exportDenied = await app.fetch(
      new Request(`${BASE}/v1/profiles/${created.profile.id}/pack/export`, {
        headers: memberSession.headers({}, orgId),
      })
    );
    expect(exportDenied.status).toBe(403);

    const importDenied = await app.fetch(
      new Request(`${BASE}/v1/profiles/pack/import/preview`, {
        body: JSON.stringify({ data: "YQ==" }),
        headers: memberSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": memberSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );
    expect(importDenied.status).toBe(403);
  }, 30_000);

  test("platform admin who is an org member can export a profile pack", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const { orgId, platformSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-platform",
      "pack-platform-org@example.com"
    );

    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );
    expect(platformUser?.id).toBeTruthy();

    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId,
      role: "member",
      userId: platformUser!.id,
    });

    const created = await profileService.createProfile(orgId, {
      name: "Platform Packable",
    });

    const response = await app.fetch(
      new Request(`${BASE}/v1/profiles/${created.profile.id}/pack/export`, {
        headers: platformSession.headers({}, orgId),
      })
    );

    expect(response.status).toBe(200);
  }, 30_000);

  test("exporting Super Bot is rejected", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-super",
      "pack-super@example.com"
    );

    const superBot = await profileService.createProfile(orgId, {
      isSuper: true,
      name: "Super Bot",
    });

    const response = await app.fetch(
      new Request(`${BASE}/v1/profiles/${superBot.profile.id}/pack/export`, {
        headers: adminSession.headers({}, orgId),
      })
    );

    expect(response.status).toBe(400);
  }, 30_000);
});
