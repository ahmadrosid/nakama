import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getProfileSoulDir, NakamaApiError } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AuthService } from "./auth-service";
import { OrgService } from "./org-service";

setupTestConfigDir("nakama-org-service-test-");

function createOrgService() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    authService,
    databaseAdapter,
    orgService: new OrgService(databaseAdapter, authService),
  };
}

describe("OrgService", () => {
  test("bootstrapInitialSetup creates org and admin membership", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "+628123456789",
      },
      organization: { name: "Acme", slug: "acme" },
    });

    expect(bootstrapped.organization.slug).toBe("acme");
    expect(bootstrapped.user.email).toBe("admin@acme.com");

    const members = await orgService.listMembers(bootstrapped.organization.id);
    expect(members.members).toHaveLength(1);
    expect(members.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
    ]);

    const profiles = await databaseAdapter.listProfilesForOrg(
      bootstrapped.organization.id
    );
    expect(profiles.some((profile) => profile.isDefault)).toBe(true);
    expect(profiles.some((profile) => profile.isSuper)).toBe(true);

    const defaultProfile = profiles.find((profile) => profile.isDefault);
    expect(defaultProfile).toBeTruthy();
    const soulPath = join(
      getProfileSoulDir(bootstrapped.organization.id, defaultProfile!.id),
      "SOUL.md"
    );
    const soulContent = await readFile(soulPath, "utf8");
    expect(soulContent).not.toContain("# Your Name");
  });

  test("bootstrapInitialSetup allows admin without phone", async () => {
    const { orgService, authService } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin-no-phone@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-no-phone" },
    });

    expect(bootstrapped.user.phone).toBeNull();
    expect(bootstrapped.user.isPlatformAdmin).toBe(true);
  });

  test("lists and switches active orgs for a user", async () => {
    const { orgService, authService } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-switch" },
    });

    const second = await orgService.createOrganization(
      { name: "Beta", slug: "beta-switch" },
      bootstrapped.user.id
    );

    const orgs = await orgService.listUserOrgs(bootstrapped.user.id);
    expect(orgs.orgs.map((org) => org.slug)).toEqual([
      "acme-switch",
      "beta-switch",
    ]);

    const switched = await orgService.setActiveOrg({
      orgId: second.organization.id,
      userId: bootstrapped.user.id,
    });
    expect(switched.slug).toBe("beta-switch");
  });

  test("updates organization consolidate flag", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-corp",
    });

    expect(created.organization.skillsCuratorConsolidateEnabled).toBe(false);

    const updated = await orgService.updateOrganization(
      created.organization.id,
      {
        skillsCuratorConsolidateEnabled: true,
      }
    );

    expect(updated.skillsCuratorConsolidateEnabled).toBe(true);
  });

  test("persists validated skill curator freshness clocks", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-freshness-clocks",
    });

    expect(created.organization.skillsCuratorStaleAfterDays).toBe(30);
    expect(created.organization.skillsCuratorArchiveAfterDays).toBe(90);

    await expect(
      orgService.updateOrganization(created.organization.id, {
        skillsCuratorArchiveAfterDays: 7,
        skillsCuratorStaleAfterDays: 7,
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      orgService.updateOrganization(created.organization.id, {
        skillsCuratorStaleAfterDays: 1.5,
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      orgService.updateOrganization(created.organization.id, {
        skillsCuratorArchiveAfterDays: 3651,
      })
    ).rejects.toMatchObject({ status: 400 });

    const updated = await orgService.updateOrganization(
      created.organization.id,
      {
        skillsCuratorArchiveAfterDays: 21,
        skillsCuratorStaleAfterDays: 7,
      }
    );
    expect(updated.skillsCuratorStaleAfterDays).toBe(7);
    expect(updated.skillsCuratorArchiveAfterDays).toBe(21);
  });

  test("updates organization name", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-corp",
    });

    const updated = await orgService.updateOrganization(
      created.organization.id,
      {
        name: "Acme Incorporated",
      }
    );

    expect(updated.name).toBe("Acme Incorporated");
    expect(updated.slug).toBe("acme-corp");
  });

  test("creates and lists organizations", async () => {
    const { orgService, databaseAdapter } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-corp",
    });

    expect(created.organization.name).toBe("Acme Corp");
    expect(created.organization.slug).toBe("acme-corp");
    expect(created.organization.id).toStartWith("org_");
    expect(created.adminMember).toBeUndefined();

    const organizations = await orgService.listOrganizations();
    expect(organizations).toEqual([created.organization]);

    const members = await orgService.listMembers(created.organization.id);
    expect(members.members).toHaveLength(0);

    const profiles = await databaseAdapter.listProfilesForOrg(
      created.organization.id
    );
    expect(
      profiles.some(
        (profile) => profile.isSuper && profile.name === "Super Bot"
      )
    ).toBe(true);
  });

  test("provisions a first admin when admin details are provided", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme Corp",
      slug: "acme-corp",
    });

    expect(created.adminMember?.member.email).toBe("admin@acme.com");
    expect(created.adminMember?.member.name).toBe("Acme Admin");
    expect(created.adminMember?.member.phone).toBe("+628123456789");
    expect(created.adminMember?.member.role).toBe("admin");
    expect(created.adminMember?.temporaryPassword).toHaveLength(12);
  });

  test("adds a member with a generated temporary password", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme",
    });

    const added = await orgService.addMember({
      email: "member@acme.com",
      name: "Member One",
      orgId: created.organization.id,
      phone: "+628987654321",
      role: "member",
    });

    expect(added.member.email).toBe("member@acme.com");
    expect(added.temporaryPassword).toHaveLength(12);
  });

  test("adds a member without phone", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-no-member-phone",
    });

    const added = await orgService.addMember({
      email: "member-no-phone@acme.com",
      name: "Member Two",
      orgId: created.organization.id,
      phone: "",
      role: "member",
    });

    expect(added.member.email).toBe("member-no-phone@acme.com");
    expect(added.member.phone).toBeNull();
    expect(added.temporaryPassword).toHaveLength(12);
  });

  test("allows changing password after provisioning", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme",
    });

    const tempPassword = created.adminMember!.temporaryPassword!;
    const userId = created.adminMember!.member.userId;

    await orgService.changePassword({
      currentPassword: tempPassword,
      newPassword: "new-password-123",
      userId,
    });

    await expect(
      orgService.changePassword({
        currentPassword: tempPassword,
        newPassword: "another-password-123",
        userId,
      })
    ).rejects.toMatchObject({
      message: "Current password is incorrect.",
      status: 401,
    });
  });

  test("revokes all browser sessions when password changes", async () => {
    const { orgService, databaseAdapter } = createOrgService();
    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme-revoke-sessions",
    });

    const userId = created.adminMember!.member.userId;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    await databaseAdapter.createBrowserSession({
      createdAt: now,
      csrfTokenHash: "csrf_a",
      expiresAt,
      id: "bs_a",
      lastUsedAt: null,
      revokedAt: null,
      sessionTokenHash: "hash_a",
      userId,
    });
    await databaseAdapter.createBrowserSession({
      createdAt: now,
      csrfTokenHash: "csrf_b",
      expiresAt,
      id: "bs_b",
      lastUsedAt: null,
      revokedAt: null,
      sessionTokenHash: "hash_b",
      userId,
    });

    await orgService.changePassword({
      currentPassword: created.adminMember!.temporaryPassword!,
      newPassword: "new-password-123",
      userId,
    });

    const sessionA =
      await databaseAdapter.getBrowserSessionBySessionTokenHash("hash_a");
    const sessionB =
      await databaseAdapter.getBrowserSessionBySessionTokenHash("hash_b");

    expect(sessionA?.revokedAt).toBeTruthy();
    expect(sessionB?.revokedAt).toBeTruthy();
  });

  test("updates own profile email phone and name", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme-profile",
    });

    const userId = created.adminMember!.member.userId;
    const updated = await orgService.updateOwnProfile(userId, {
      email: "updated@acme.com",
      name: "Updated Admin",
      phone: "",
    });

    expect(updated.name).toBe("Updated Admin");
    expect(updated.email).toBe("updated@acme.com");
    expect(updated.phone).toBeNull();
  });

  test("rejects duplicate slugs", async () => {
    const { orgService } = createOrgService();

    await orgService.createOrganization({ name: "Acme", slug: "acme" });

    await expect(
      orgService.createOrganization({ name: "Acme 2", slug: "acme" })
    ).rejects.toMatchObject({
      message: "Organization slug already exists.",
      status: 409,
    });
  });

  test("rejects invalid slugs", async () => {
    const { orgService } = createOrgService();

    await expect(
      orgService.createOrganization({ name: "Acme", slug: "Acme Corp" })
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  test("accepts an invite for a new user", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme",
    });
    const invite = await orgService.createInvite({
      email: "legacy@acme.com",
      invitedByUserId: "user_platform",
      orgId: created.organization.id,
      role: "member",
    });

    const accepted = await orgService.acceptInvite({
      password: "secret123",
      token: invite.token,
    });

    expect(accepted.user.email).toBe("legacy@acme.com");
    expect(accepted.orgId).toBe(created.organization.id);
    expect(accepted.role).toBe("member");
  });

  test("rejects expired invites", async () => {
    const { orgService, databaseAdapter } = createOrgService();
    const authService = new AuthService();
    const token = "tc_invite_expired";
    const now = new Date().toISOString();

    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_acme",
      name: "Acme",
      slug: "acme",
      updatedAt: now,
    });
    await databaseAdapter.createOrgInvite({
      acceptedAt: null,
      createdAt: now,
      email: "admin@acme.com",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      id: "invite_expired",
      invitedByUserId: "user_platform",
      orgId: "org_acme",
      revokedAt: null,
      role: "admin",
      tokenHash: authService.hashToken(token),
    });

    await expect(
      orgService.acceptInvite({ password: "secret123", token })
    ).rejects.toMatchObject({
      message: "Invite has expired.",
      status: 400,
    });
  });

  test("rejects empty names", async () => {
    const { orgService } = createOrgService();

    await expect(
      orgService.createOrganization({ name: "   ", slug: "acme" })
    ).rejects.toBeInstanceOf(NakamaApiError);
  });

  test("lists, updates, and removes members", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme",
    });

    const added = await orgService.addMember({
      email: "viewer@acme.com",
      name: "Viewer One",
      orgId: created.organization.id,
      phone: "+628111111111",
      role: "viewer",
    });

    const listed = await orgService.listMembers(created.organization.id);
    expect(listed.members).toHaveLength(2);
    expect(listed.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
      "viewer@acme.com",
    ]);

    const updated = await orgService.updateMember(
      created.organization.id,
      added.member.userId,
      {
        name: "Viewer Prime",
        phone: "+628222333444",
        role: "member",
      }
    );
    expect(updated.member.name).toBe("Viewer Prime");
    expect(updated.member.phone).toBe("+628222333444");
    expect(updated.member.role).toBe("member");

    await orgService.removeMember(created.organization.id, added.member.userId);
    const afterRemoval = await orgService.listMembers(created.organization.id);
    expect(afterRemoval.members).toHaveLength(1);
    expect(afterRemoval.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
    ]);
  });

  test("protects the last org admin from removal or demotion", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme",
    });

    const adminUserId = created.adminMember!.member.userId;
    const localClientUserId = LOCAL_CLIENT_USER_ID;

    expect(localClientUserId).toBeTruthy();

    await orgService.removeMember(created.organization.id, adminUserId);

    await expect(
      orgService.removeMember(created.organization.id, localClientUserId!)
    ).rejects.toMatchObject({
      message: "Cannot remove the last org admin.",
      status: 409,
    });

    await expect(
      orgService.updateMember(created.organization.id, localClientUserId!, {
        role: "member",
      })
    ).rejects.toMatchObject({
      message: "Cannot change role of the last org admin.",
      status: 409,
    });
  });

  test("archives an org and hides it from membership lists", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService();
    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-archive" },
    });
    const second = await orgService.createOrganization(
      { name: "Beta", slug: "beta-archive" },
      bootstrapped.user.id
    );

    const archived = await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );

    expect(archived.archivedAt).toBeTruthy();
    const listed = await orgService.listUserOrgs(bootstrapped.user.id);
    expect(listed.orgs.map((org) => org.id)).toEqual([second.organization.id]);

    const stored = await databaseAdapter.getOrganizationById(
      bootstrapped.organization.id
    );
    expect(stored?.archivedAt).toBeTruthy();

    await expect(
      orgService.setActiveOrg({
        orgId: bootstrapped.organization.id,
        userId: bootstrapped.user.id,
      })
    ).rejects.toMatchObject({ status: 404 });

    const resolved = await orgService.resolveActiveOrgId(
      bootstrapped.user.id,
      undefined,
      bootstrapped.organization.id
    );
    expect(resolved).toBe(second.organization.id);
  });

  test("clears a stale session org when the user has no remaining memberships", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService();
    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-session-clear" },
    });
    await databaseAdapter.createBrowserSession({
      activeOrgId: bootstrapped.organization.id,
      createdAt: new Date().toISOString(),
      csrfTokenHash: "csrf",
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "session_stale",
      lastUsedAt: null,
      revokedAt: null,
      sessionTokenHash: "token_stale",
      userId: bootstrapped.user.id,
    });
    await databaseAdapter.upsertOrganization({
      ...(await databaseAdapter.getOrganizationById(
        bootstrapped.organization.id
      ))!,
      archivedAt: new Date().toISOString(),
    });

    const resolved = await orgService.resolveActiveOrgId(
      bootstrapped.user.id,
      "session_stale",
      bootstrapped.organization.id
    );
    expect(resolved).toBeNull();

    const session =
      await databaseAdapter.getBrowserSessionBySessionTokenHash("token_stale");
    expect(session?.activeOrgId).toBeNull();
  });

  test("refuses to archive the actor's last remaining membership", async () => {
    const { orgService, authService } = createOrgService();
    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-last-membership" },
    });
    await orgService.createOrganization({
      name: "Other",
      slug: "other-last-membership",
    });

    await expect(
      orgService.archiveOrganization(
        bootstrapped.organization.id,
        bootstrapped.user.id
      )
    ).rejects.toMatchObject({ status: 409 });
  });

  test("refuses updates on an archived org", async () => {
    const { orgService, authService } = createOrgService();
    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-update-archive" },
    });
    await orgService.createOrganization(
      { name: "Beta", slug: "beta-update-archive" },
      bootstrapped.user.id
    );
    await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );

    await expect(
      orgService.updateOrganization(bootstrapped.organization.id, {
        name: "Renamed",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  test("refuses to archive the last active org", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Only",
      slug: "only-org",
    });

    await expect(
      orgService.archiveOrganization(created.organization.id)
    ).rejects.toMatchObject({ status: 409 });

    const stillListed = await orgService.listOrganizations();
    expect(stillListed).toHaveLength(1);
    expect(stillListed[0]?.archivedAt).toBeNull();
  });

  test("refuses a second archive and unknown id", async () => {
    const { orgService, authService } = createOrgService();
    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-twice" },
    });
    await orgService.createOrganization(
      { name: "Beta", slug: "beta-twice" },
      bootstrapped.user.id
    );
    await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );

    await expect(
      orgService.archiveOrganization(
        bootstrapped.organization.id,
        bootstrapped.user.id
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orgService.archiveOrganization("org_missing")
    ).rejects.toMatchObject({ status: 404 });
  });

  test("rejects invite accept for an archived org", async () => {
    const { orgService, authService } = createOrgService();
    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-invite-archive" },
    });
    await orgService.createOrganization(
      { name: "Beta", slug: "beta-invite-archive" },
      bootstrapped.user.id
    );
    const invite = await orgService.createInvite({
      email: "guest@acme.com",
      invitedByUserId: bootstrapped.user.id,
      orgId: bootstrapped.organization.id,
      role: "member",
    });
    await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );

    await expect(
      orgService.acceptInvite({ password: "secret123", token: invite.token })
    ).rejects.toMatchObject({ status: 404 });
  });
});
