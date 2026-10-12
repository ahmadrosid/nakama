import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
  type TestBrowserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-member-agents-routes-");

const BASE = "http://localhost:4310";

async function setup() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);

  const { app, authService } = createMinimalHonoApp({
    agent: {
      createProfile: (
        orgId: string,
        request: Parameters<ProfileService["createProfile"]>[1],
        owner?: Parameters<ProfileService["createProfile"]>[2]
      ) => profileService.createProfile(orgId, request, owner),
      deleteProfile: (orgId: string, profileId: string) =>
        profileService.deleteProfile(orgId, profileId),
      getProfile: (orgId: string, profileId: string) =>
        profileService.getProfile(orgId, profileId),
      listProfiles: (orgId: string) => profileService.listProfiles(orgId),
      updateProfile: (
        orgId: string,
        profileId: string,
        request: Parameters<ProfileService["updateProfile"]>[2],
        meta?: Parameters<ProfileService["updateProfile"]>[3]
      ) => profileService.updateProfile(orgId, profileId, request, meta),
    },
    databaseAdapter,
  });

  const admin = await setupFreshInstallSession(
    app,
    databaseAdapter,
    "member-agents-admin@example.com"
  );

  const orgId = admin.orgId!;

  async function addMember(email: string) {
    const now = new Date().toISOString();

    await databaseAdapter.createUser({
      createdAt: now,
      email,
      id: `user_${email}`,
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: `user_${email}`,
    });

    return loginUserSession(app, email, "password123", orgId);
  }

  const request = (
    session: TestBrowserSession,
    path: string,
    init: { body?: unknown; method?: string } = {}
  ) =>
    app.fetch(
      new Request(`${BASE}${path}`, {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          ...session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
        },
        method: init.method ?? "GET",
      })
    );

  const listNames = async (session: Parameters<typeof request>[0]) => {
    // SAFETY: This test controls the fixture shape at this boundary.
    const body = (await (await request(session, "/v1/profiles")).json()) as {
      profiles: Array<{ name: string }>;
    };

    return body.profiles.map((profile) => profile.name);
  };

  return { addMember, admin, listNames, request };
}

describe("member-owned agents", () => {
  test("a member creates a private agent that only they and admins can see", async () => {
    const { addMember, admin, listNames, request } = await setup();
    const owner = await addMember("owner@example.com");
    const other = await addMember("other@example.com");

    const created = await request(owner, "/v1/profiles", {
      body: { isSuper: true, name: "Mine" },
      method: "POST",
    });

    expect(created.status).toBe(201);

    // SAFETY: This test controls the fixture shape at this boundary.
    const { profile } = (await created.json()) as {
      profile: {
        id: string;
        isSuper: boolean;
        ownerUserId: string;
        sharedWithTeam: boolean;
      };
    };

    expect(profile.isSuper).toBe(false);
    expect(profile.ownerUserId).toBe("user_owner@example.com");
    expect(profile.sharedWithTeam).toBe(false);

    expect(await listNames(owner)).toContain("Mine");
    expect(await listNames(admin)).toContain("Mine");
    expect(await listNames(other)).not.toContain("Mine");
  }, 20_000);

  test("a member's describe-it request creates a private agent without Super Bot", async () => {
    const { addMember, listNames, request } = await setup();
    const owner = await addMember("owner3@example.com");
    const other = await addMember("other3@example.com");

    const created = await request(owner, "/v1/profiles/with-super-bot", {
      body: { prompt: "Draft clear short emails from my notes" },
      method: "POST",
    });

    expect(created.status).toBe(201);

    // SAFETY: This test controls the fixture shape at this boundary.
    const { profile } = (await created.json()) as {
      profile: { name: string; ownerUserId: string; sharedWithTeam: boolean };
    };

    expect(profile.ownerUserId).toBe("user_owner3@example.com");
    expect(profile.sharedWithTeam).toBe(false);
    expect(await listNames(owner)).toContain(profile.name);
    expect(await listNames(other)).not.toContain(profile.name);
  }, 20_000);

  test("the owner edits and shares the agent; other members cannot edit it", async () => {
    const { addMember, admin, listNames, request } = await setup();
    const owner = await addMember("owner2@example.com");
    const other = await addMember("other2@example.com");

    const created = await request(owner, "/v1/profiles", {
      body: { name: "Shared later" },
      method: "POST",
    });

    // SAFETY: This test controls the fixture shape at this boundary.
    const { profile } = (await created.json()) as { profile: { id: string } };
    const path = `/v1/profiles/${profile.id}`;

    expect(
      (await request(other, path, { body: { name: "Hijack" }, method: "PUT" }))
        .status
    ).toBe(403);

    expect(
      (await request(owner, path, { body: { name: "Renamed" }, method: "PUT" }))
        .status
    ).toBe(200);

    expect(
      (
        await request(owner, path, {
          body: { acpAgent: { command: "sh" } },
          method: "PUT",
        })
      ).status
    ).toBe(403);

    expect(
      (
        await request(owner, path, {
          body: { automationsEnabled: false },
          method: "PUT",
        })
      ).status
    ).toBe(200);

    expect(
      (
        await request(owner, path, {
          body: { skillsWriteApproval: false },
          method: "PUT",
        })
      ).status
    ).toBe(403);

    // An admin cannot force-share a member's agent.
    expect(
      (
        await request(admin, path, {
          body: { sharedWithTeam: true },
          method: "PUT",
        })
      ).status
    ).toBe(403);

    expect(await listNames(other)).not.toContain("Renamed");

    await request(owner, path, {
      body: { sharedWithTeam: true },
      method: "PUT",
    });

    expect(await listNames(other)).toContain("Renamed");
    expect((await request(other, path, { method: "DELETE" })).status).toBe(403);
    expect((await request(owner, path, { method: "DELETE" })).status).toBe(204);
  }, 20_000);
});
