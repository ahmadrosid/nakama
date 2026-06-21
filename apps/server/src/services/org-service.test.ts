import { describe, expect, test } from "bun:test";
import { TinyClawApiError } from "@tinyclaw/core";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { AuthService } from "./auth-service";
import { OrgService } from "./org-service";

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
    const { orgService, authService } = createOrgService();

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
    expect(members.members).toHaveLength(1);
    expect(members.members[0]?.role).toBe("admin");
  });

  test("creates and lists organizations", async () => {
    const { orgService } = createOrgService();

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
    expect(listed.members).toHaveLength(2);
    expect(listed.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
      "viewer@acme.com",
    ]);

    const updated = await orgService.updateMemberRole(
      created.organization.id,
      added.member.userId,
      "member",
    );
    expect(updated.member.role).toBe("member");

    await orgService.removeMember(created.organization.id, added.member.userId);
    const afterRemoval = await orgService.listMembers(created.organization.id);
    expect(afterRemoval.members).toHaveLength(1);
    expect(afterRemoval.members[0]?.email).toBe("admin@acme.com");
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

    await expect(
      orgService.removeMember(created.organization.id, adminUserId),
    ).rejects.toMatchObject({
      status: 409,
      message: "Cannot remove the last org admin.",
    });

    await expect(
      orgService.updateMemberRole(created.organization.id, adminUserId, "member"),
    ).rejects.toMatchObject({
      status: 409,
      message: "Cannot change role of the last org admin.",
    });
  });
});
