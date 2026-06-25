import { describe, expect, test } from "bun:test";
import { TinyClawApiError } from "@tinyclaw/core";
import { LOCAL_CLIENT_EMAIL } from "@tinyclaw/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { AuthService } from "./auth-service";
import { OrgService } from "./org-service";
import { setupTestConfigDir } from "../test-config-dir";

setupTestConfigDir("tinyclaw-org-service-test-");

function createOrgService() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    databaseAdapter,
    authService,
    orgService: new OrgService(databaseAdapter, authService),
  };
}

describe("OrgService", () => {
  test("bootstrapInitialSetup creates org and admin membership", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      organization: { name: "Acme", slug: "acme" },
      admin: {
        name: "Acme Admin",
        email: "admin@acme.com",
        phone: "+628123456789",
        passwordHash: await authService.hashPassword("password123"),
      },
    });

    expect(bootstrapped.organization.slug).toBe("acme");
    expect(bootstrapped.user.email).toBe("admin@acme.com");

    const members = await orgService.listMembers(bootstrapped.organization.id);
    expect(members.members).toHaveLength(2);
    expect(members.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
      LOCAL_CLIENT_EMAIL,
    ]);

    const profiles = await databaseAdapter.listProfilesForOrg(bootstrapped.organization.id);
    expect(profiles.some((profile) => profile.isDefault)).toBe(true);
    expect(profiles.some((profile) => profile.isSuper)).toBe(true);
  });

  test("bootstrapInitialSetup allows admin without phone", async () => {
    const { orgService, authService } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      organization: { name: "Acme", slug: "acme-no-phone" },
      admin: {
        name: "Acme Admin",
        email: "admin-no-phone@acme.com",
        phone: "",
        passwordHash: await authService.hashPassword("password123"),
      },
    });

    expect(bootstrapped.user.phone).toBeNull();
    expect(bootstrapped.user.isPlatformAdmin).toBe(true);
  });

  test("lists and switches active orgs for a user", async () => {
    const { orgService, authService } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      organization: { name: "Acme", slug: "acme-switch" },
      admin: {
        name: "Acme Admin",
        email: "admin@acme.com",
        phone: "",
        passwordHash: await authService.hashPassword("password123"),
      },
    });

    const second = await orgService.createOrganization(
      { name: "Beta", slug: "beta-switch" },
      bootstrapped.user.id,
    );

    const orgs = await orgService.listUserOrgs(bootstrapped.user.id);
    expect(orgs.orgs.map((org) => org.slug)).toEqual(["acme-switch", "beta-switch"]);

    const switched = await orgService.setActiveOrg({
      userId: bootstrapped.user.id,
      orgId: second.organization.id,
    });
    expect(switched.slug).toBe("beta-switch");
  });

  test("updates organization name", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-corp",
    });

    const updated = await orgService.updateOrganization(created.organization.id, {
      name: "Acme Incorporated",
    });

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
    expect(members.members).toHaveLength(1);
    expect(members.members[0]?.email).toBe(LOCAL_CLIENT_EMAIL);
    expect(members.members[0]?.role).toBe("admin");

    const profiles = await databaseAdapter.listProfilesForOrg(created.organization.id);
    expect(profiles.some((profile) => profile.isSuper && profile.name === "Super Bot")).toBe(true);
  });

  test("provisions a first admin when admin details are provided", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-corp",
      admin: {
        name: "Acme Admin",
        email: "admin@acme.com",
        phone: "+628123456789",
      },
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
      orgId: created.organization.id,
      name: "Member One",
      email: "member@acme.com",
      phone: "+628987654321",
      role: "member",
    });

    expect(added.member.email).toBe("member@acme.com");
    expect(added.temporaryPassword).toHaveLength(12);
  });

  test("allows changing password after provisioning", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme",
      admin: {
        name: "Acme Admin",
        email: "admin@acme.com",
        phone: "+628123456789",
      },
    });

    const tempPassword = created.adminMember!.temporaryPassword!;
    const userId = created.adminMember!.member.userId;

    await orgService.changePassword({
      userId,
      currentPassword: tempPassword,
      newPassword: "new-password-123",
    });

    await expect(
      orgService.changePassword({
        userId,
        currentPassword: tempPassword,
        newPassword: "another-password-123",
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: "Current password is incorrect.",
    });
  });

  test("rejects duplicate slugs", async () => {
    const { orgService } = createOrgService();

    await orgService.createOrganization({ name: "Acme", slug: "acme" });

    await expect(orgService.createOrganization({ name: "Acme 2", slug: "acme" })).rejects.toMatchObject({
      status: 409,
      message: "Organization slug already exists.",
    });
  });

  test("rejects invalid slugs", async () => {
    const { orgService } = createOrgService();

    await expect(
      orgService.createOrganization({ name: "Acme", slug: "Acme Corp" }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  test("accepts an invite for a new user", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({ name: "Acme", slug: "acme" });
    const invite = await orgService.createInvite({
      orgId: created.organization.id,
      email: "legacy@acme.com",
      role: "member",
      invitedByUserId: "user_platform",
    });

    const accepted = await orgService.acceptInvite({
      token: invite.token,
      password: "secret123",
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
      id: "org_acme",
      name: "Acme",
      slug: "acme",
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.createOrgInvite({
      id: "invite_expired",
      orgId: "org_acme",
      email: "admin@acme.com",
      role: "admin",
      tokenHash: authService.hashToken(token),
      invitedByUserId: "user_platform",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    });

    await expect(
      orgService.acceptInvite({ token, password: "secret123" }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Invite has expired.",
    });
  });

  test("rejects empty names", async () => {
    const { orgService } = createOrgService();

    await expect(
      orgService.createOrganization({ name: "   ", slug: "acme" }),
    ).rejects.toBeInstanceOf(TinyClawApiError);
  });

  test("lists, updates, and removes members", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme",
      admin: {
        name: "Acme Admin",
        email: "admin@acme.com",
        phone: "+628123456789",
      },
    });

    const added = await orgService.addMember({
      orgId: created.organization.id,
      name: "Viewer One",
      email: "viewer@acme.com",
      phone: "+628111111111",
      role: "viewer",
    });

    const listed = await orgService.listMembers(created.organization.id);
    expect(listed.members).toHaveLength(3);
    expect(listed.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
      LOCAL_CLIENT_EMAIL,
      "viewer@acme.com",
    ]);

    const updated = await orgService.updateMember(created.organization.id, added.member.userId, {
      name: "Viewer Prime",
      phone: "+628222333444",
      role: "member",
    });
    expect(updated.member.name).toBe("Viewer Prime");
    expect(updated.member.phone).toBe("+628222333444");
    expect(updated.member.role).toBe("member");

    await orgService.removeMember(created.organization.id, added.member.userId);
    const afterRemoval = await orgService.listMembers(created.organization.id);
    expect(afterRemoval.members).toHaveLength(2);
    expect(afterRemoval.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
      LOCAL_CLIENT_EMAIL,
    ]);
  });

  test("protects the last org admin from removal or demotion", async () => {
    const { orgService } = createOrgService();
    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme",
      admin: {
        name: "Acme Admin",
        email: "admin@acme.com",
        phone: "+628123456789",
      },
    });

    const adminUserId = created.adminMember!.member.userId;
    const localClientUserId = created.organization.id
      ? (await orgService.listMembers(created.organization.id)).members.find(
          (member) => member.email === LOCAL_CLIENT_EMAIL,
        )?.userId
      : undefined;

    expect(localClientUserId).toBeTruthy();

    await orgService.removeMember(created.organization.id, adminUserId);

    await expect(
      orgService.removeMember(created.organization.id, localClientUserId!),
    ).rejects.toMatchObject({
      status: 409,
      message: "Cannot remove the last org admin.",
    });

    await expect(
      orgService.updateMember(created.organization.id, localClientUserId!, { role: "member" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Cannot change role of the last org admin.",
    });
  });
});
