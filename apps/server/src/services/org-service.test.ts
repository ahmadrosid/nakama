import { describe, expect, spyOn, test } from "bun:test";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  attachSharedKnowledgeBaseDocument,
  type EmailOutboundAdapter,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
  getOrgConfigDir,
  getOrgKnowledgeBaseDir,
  getProfileSoulDir,
  getUserConfigDir,
  getUserConfigPath,
  listOrganizationKnowledgeBaseDocuments,
  loadUserConfig,
  NakamaApiError,
  resolveProfileSkillDirectory,
  saveUserConfig,
  type ToolSetupPlan,
  uploadKnowledgeBaseDocument,
  uploadOrganizationKnowledgeBaseDocument,
  writeParsedConfigIni,
} from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AuthService } from "./auth-service";
import {
  loadToolApiKey,
  loadToolSetup,
  saveToolApiKey,
  saveToolSetup,
} from "./custom-tool-shared";
import { OrgService } from "./org-service";
import { modelExistsOnInstance } from "./provider-instance-helpers";

setupTestConfigDir("nakama-org-service-test-");

function createOrgService(
  email?: EmailOutboundAdapter,
  getWebPublicUrl?: () => string | undefined
) {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  return {
    authService,
    databaseAdapter,
    orgService: new OrgService(
      databaseAdapter,
      authService,
      email,
      getWebPublicUrl
    ),
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

  test("updates organization monthly LLM turn limit", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme Corp",
      slug: "acme-usage-limit",
    });

    const updated = await orgService.updateOrganization(
      created.organization.id,
      {
        monthlyLlmTurnLimit: 250,
      }
    );

    expect(updated.monthlyLlmTurnLimit).toBe(250);
    await expect(
      orgService.updateOrganization(created.organization.id, {
        monthlyLlmTurnLimit: -1,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("stores normalized allowed invite domains for an organization", async () => {
    const { databaseAdapter, orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-invite-domains",
    });

    const updated = await orgService.updateOrganization(
      created.organization.id,
      { allowedInviteDomains: [" Acme.COM ", "partner.example", "acme.com"] }
    );

    expect(updated.allowedInviteDomains).toEqual([
      "acme.com",
      "partner.example",
    ]);
    expect(
      (await databaseAdapter.getOrganizationById(created.organization.id))
        ?.allowedInviteDomains
    ).toEqual(["acme.com", "partner.example"]);
  });

  test("rejects malformed invite-domain settings without replacing the policy", async () => {
    const { databaseAdapter, orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-invalid-invite-domains",
    });

    await orgService.updateOrganization(created.organization.id, {
      allowedInviteDomains: ["acme.com"],
    });

    for (const allowedInviteDomains of [
      ["*.acme.com"],
      [""],
      // SAFETY: This deliberately wrong input tests runtime validation.
      "acme.com" as unknown as string[],
    ]) {
      await expect(
        orgService.updateOrganization(created.organization.id, {
          allowedInviteDomains,
        })
      ).rejects.toMatchObject({ status: 400 });
    }

    expect(
      (await databaseAdapter.getOrganizationById(created.organization.id))
        ?.allowedInviteDomains
    ).toEqual(["acme.com"]);
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

  test("rejects member names with control characters", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-member-control-chars",
    });

    await expect(
      orgService.addMember({
        email: "control@acme.com",
        name: "Bad\r\nName",
        orgId: created.organization.id,
        phone: "",
        role: "member",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects member names longer than 120 characters", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-member-name-too-long",
    });

    await expect(
      orgService.addMember({
        email: "long@acme.com",
        name: "a".repeat(121),
        orgId: created.organization.id,
        phone: "",
        role: "member",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects empty member names", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-empty-member-name",
    });

    await expect(
      orgService.addMember({
        email: "empty@acme.com",
        name: "   ",
        orgId: created.organization.id,
        phone: "",
        role: "member",
      })
    ).rejects.toMatchObject({ status: 400 });
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
      currentPassword: created.adminMember!.temporaryPassword!,
      email: "updated@acme.com",
      name: "Updated Admin",
      phone: "",
    });

    expect(updated.id).toBe(userId);
    expect(updated.name).toBe("Updated Admin");
    expect(updated.email).toBe("updated@acme.com");
    expect(updated.phone).toBeNull();

    const profileOnly = await orgService.updateOwnProfile(userId, {
      name: "Renamed Admin",
    });

    expect(profileOnly.name).toBe("Renamed Admin");
  });

  test("requires the current password before changing email", async () => {
    const { databaseAdapter, orgService } = createOrgService();

    const created = await orgService.createOrganization({
      admin: { email: "admin@acme.com", name: "Acme Admin", phone: "" },
      name: "Acme",
      slug: "acme-email-reauth",
    });

    const userId = created.adminMember!.member.userId;

    await expect(
      orgService.updateOwnProfile(userId, { email: "attacker@example.com" })
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      orgService.updateOwnProfile(userId, {
        currentPassword: "wrong-password",
        email: "attacker@example.com",
      })
    ).rejects.toMatchObject({ status: 401 });
    expect((await databaseAdapter.getUserById(userId))?.email).toBe(
      "admin@acme.com"
    );
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
      token: invite.token!,
    });

    expect(accepted.user.email).toBe("legacy@acme.com");
    expect(accepted.orgId).toBe(created.organization.id);
    expect(accepted.role).toBe("member");
  });

  test("only creates invites for allowed email domains", async () => {
    const sent: string[] = [];

    const { databaseAdapter, orgService } = createOrgService({
      send: async (input) => {
        sent.push(input.to);

        return { ok: true };
      },
    });

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-invite-restriction",
    });

    await orgService.updateOrganization(created.organization.id, {
      allowedInviteDomains: ["acme.com"],
    });

    await expect(
      orgService.createInvite({
        email: "guest@other.com",
        invitedByUserId: "user_platform",
        orgId: created.organization.id,
        role: "member",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await databaseAdapter.getPendingOrgInvite(
        created.organization.id,
        "guest@other.com"
      )
    ).toBeNull();
    expect(sent).toEqual([]);

    const allowed = await orgService.createInvite({
      email: "guest@ACME.COM",
      invitedByUserId: "user_platform",
      orgId: created.organization.id,
      role: "member",
    });

    expect(allowed.invite.email).toBe("guest@acme.com");
    expect(sent).toEqual(["guest@acme.com"]);
  });

  test("rejects an existing invite if the allowed domains change before acceptance", async () => {
    const { databaseAdapter, orgService } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-invite-policy-change",
    });

    const invite = await orgService.createInvite({
      email: "guest@other.com",
      invitedByUserId: "user_platform",
      orgId: created.organization.id,
      role: "member",
    });

    await orgService.updateOrganization(created.organization.id, {
      allowedInviteDomains: ["acme.com"],
    });

    await expect(
      orgService.acceptInvite({
        password: "secret123",
        token: invite.token!,
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(await databaseAdapter.getUserByEmail("guest@other.com")).toBeNull();
    expect(
      await databaseAdapter.getPendingOrgInvite(
        created.organization.id,
        "guest@other.com"
      )
    ).not.toBeNull();
  });

  test("emails an invite link without returning its raw token", async () => {
    const sent: Array<{ subject: string; text: string; to: string }> = [];

    const { orgService } = createOrgService(
      {
        send: async (input) => {
          sent.push(input);

          return { ok: true };
        },
      },
      () => "https://nakama.example.com"
    );

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-email-invite",
    });

    const invite = await orgService.createInvite({
      email: "guest@acme.com",
      invitedByUserId: "user_platform",
      orgId: created.organization.id,
      role: "viewer",
    });

    expect(invite.delivered).toBe(true);
    expect(invite.token).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("guest@acme.com");
    expect(sent[0]?.subject).toBe("You're invited to Acme");
    expect(sent[0]?.text).toContain(
      "https://nakama.example.com/accept-invite?token="
    );
    expect(sent[0]?.text).toContain("join Acme as viewer");
  });

  test("returns the invite token when email delivery fails", async () => {
    const { orgService } = createOrgService({
      send: async () => ({ error: "SMTP unavailable", ok: false }),
    });

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-manual-invite",
    });

    const invite = await orgService.createInvite({
      email: "guest@acme.com",
      invitedByUserId: "user_platform",
      orgId: created.organization.id,
      role: "member",
    });

    expect(invite.delivered).toBe(false);
    expect(invite.token).toStartWith("tc_invite_");
  });

  test("emails a password reset link without returning its raw token", async () => {
    const sent: Array<{ subject: string; text: string; to: string }> = [];

    const { orgService, authService } = createOrgService(
      {
        send: async (input) => {
          sent.push(input);

          return { ok: true };
        },
      },
      () => "https://nakama.example.com"
    );

    await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-reset-email" },
    });

    const requested = await orgService.requestPasswordReset(" ADMIN@ACME.COM ");

    expect(requested).toEqual({ delivered: true, token: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("admin@acme.com");
    expect(sent[0]?.subject).toBe("Reset your Nakama password");
    expect(sent[0]?.text).toContain(
      "https://nakama.example.com/reset-password?token=tc_reset_"
    );
  });

  test("resets once and revokes sessions and outstanding reset tokens", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService({
      send: async () => ({ error: "SMTP unavailable", ok: false }),
    });

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-reset-once" },
    });

    const now = new Date().toISOString();
    await databaseAdapter.createBrowserSession({
      activeOrgId: bootstrapped.organization.id,
      createdAt: now,
      csrfTokenHash: "csrf_hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: "browser_reset",
      lastUsedAt: null,
      revokedAt: null,
      sessionTokenHash: "session_hash",
      userId: bootstrapped.user.id,
    });

    const earlier = await orgService.requestPasswordReset(
      "admin@acme.com",
      true
    );

    const requested = await orgService.requestPasswordReset(
      "admin@acme.com",
      true
    );

    expect(requested.delivered).toBe(false);
    expect(requested.token).toStartWith("tc_reset_");

    await orgService.resetPassword({
      newPassword: "new-password-123",
      token: requested.token!,
    });

    const updated = await databaseAdapter.getUserById(bootstrapped.user.id);
    expect(
      await authService.verifyPassword(
        "new-password-123",
        updated!.passwordHash
      )
    ).toBe(true);

    const session =
      await databaseAdapter.getBrowserSessionBySessionTokenHash("session_hash");

    expect(session?.revokedAt).not.toBeNull();
    await expect(
      orgService.resetPassword({
        newPassword: "another-password-123",
        token: requested.token!,
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      orgService.resetPassword({
        newPassword: "another-password-123",
        token: earlier.token!,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects expired password reset tokens", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-reset-expired" },
    });

    const token = "tc_reset_expired";
    const now = new Date().toISOString();
    await databaseAdapter.createPasswordResetToken({
      consumedAt: null,
      createdAt: now,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      id: "password_reset_expired",
      tokenHash: authService.hashToken(token),
      userId: bootstrapped.user.id,
    });

    await expect(
      orgService.resetPassword({ newPassword: "new-password-123", token })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("does not reveal an unknown password reset address", async () => {
    let sends = 0;

    const { orgService } = createOrgService({
      send: async () => {
        sends += 1;

        return { ok: true };
      },
    });

    expect(await orgService.requestPasswordReset("missing@acme.com")).toEqual({
      delivered: true,
      token: null,
    });
    expect(sends).toBe(0);
  });

  test("does not expose a reset token when public delivery fails", async () => {
    const { orgService, authService } = createOrgService({
      send: async () => ({ error: "SMTP unavailable", ok: false }),
    });

    await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-reset-public" },
    });

    expect(await orgService.requestPasswordReset("admin@acme.com")).toEqual({
      delivered: true,
      token: null,
    });
  });

  test("returns a public reset response without waiting for SMTP", async () => {
    let finishDelivery: (result: { ok: boolean }) => void = () => undefined;

    const delivery = new Promise<{ ok: boolean }>((resolve) => {
      finishDelivery = resolve;
    });

    const { orgService, authService } = createOrgService({
      send: () => delivery,
    });

    await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-reset-timing" },
    });

    const response = orgService.requestPasswordReset("admin@acme.com");

    const settled = await Promise.race([
      response,
      Bun.sleep(100).then(() => null),
    ]);

    finishDelivery({ ok: true });

    expect(settled).toEqual({ delivered: true, token: null });
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

  test("protects the last org admin from removal or demotion when the other admin is disabled", async () => {
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

    await orgService.disableMember(created.organization.id, localClientUserId!);

    await expect(
      orgService.removeMember(created.organization.id, adminUserId)
    ).rejects.toMatchObject({
      message: "Cannot remove the last org admin.",
      status: 409,
    });

    await expect(
      orgService.updateMember(created.organization.id, adminUserId, {
        role: "member",
      })
    ).rejects.toMatchObject({
      message: "Cannot change role of the last org admin.",
      status: 409,
    });
  });

  test("removeMember rejects bad userId shape before membership lookup", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme-shape",
    });

    await expect(
      orgService.removeMember(created.organization.id, "../etc/passwd")
    ).rejects.toMatchObject({
      message: "Invalid user id.",
      status: 400,
    });

    await expect(
      orgService.removeMember(created.organization.id, "not-a-user-id")
    ).rejects.toMatchObject({
      message: "Invalid user id.",
      status: 400,
    });
  });

  test("removeMember 404s the same for unknown userId and user not in org", async () => {
    const { orgService, databaseAdapter, authService } = createOrgService();

    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme-remove-404",
    });

    const outsiderId = "user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "outsider@example.com",
      id: outsiderId,
      name: "Outsider",
      passwordHash: await authService.hashPassword("password123"),
      phone: null,
      updatedAt: now,
    });

    const unknownId = "user_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    await expect(
      orgService.removeMember(created.organization.id, unknownId)
    ).rejects.toMatchObject({
      message: "Not found",
      status: 404,
    });

    await expect(
      orgService.removeMember(created.organization.id, outsiderId)
    ).rejects.toMatchObject({
      message: "Not found",
      status: 404,
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

  test("permanently deletes an archived org and its files", async () => {
    const { orgService, authService, databaseAdapter } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-permanent-delete" },
    });

    const kept = await orgService.createOrganization(
      { name: "Beta", slug: "beta-permanent-delete" },
      bootstrapped.user.id
    );

    const orgDir = getOrgConfigDir(bootstrapped.organization.id);
    await mkdir(orgDir, { recursive: true });
    await writeFile(join(orgDir, "private-data.txt"), "private data");

    const retiredDir = join(
      getUserConfigDir(),
      "retired-app-users",
      bootstrapped.organization.id
    );

    const keptRetired = join(
      getUserConfigDir(),
      "retired-app-users",
      kept.organization.id
    );

    await mkdir(retiredDir, { recursive: true });
    await mkdir(keptRetired, { recursive: true });
    await writeFile(join(retiredDir, "private.txt"), "retired data");
    await writeFile(join(keptRetired, "private.txt"), "kept data");

    const deletedProfile = (
      await databaseAdapter.listProfilesForOrg(bootstrapped.organization.id)
    )[0]!;

    await databaseAdapter.createBrowserSession({
      activeOrgId: bootstrapped.organization.id,
      createdAt: new Date().toISOString(),
      csrfTokenHash: "csrf_permanent_delete",
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "session_permanent_delete",
      lastUsedAt: null,
      revokedAt: null,
      sessionTokenHash: "token_permanent_delete",
      userId: bootstrapped.user.id,
    });
    await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );

    await orgService.permanentlyDeleteOrganization(
      bootstrapped.organization.id
    );

    expect(
      await databaseAdapter.getOrganizationById(bootstrapped.organization.id)
    ).toBeNull();
    expect(await databaseAdapter.getProfile(deletedProfile.id)).toBeNull();
    expect(
      await databaseAdapter.listProfilesForOrg(bootstrapped.organization.id)
    ).toEqual([]);
    expect(
      await databaseAdapter.getOrganizationById(kept.organization.id)
    ).not.toBeNull();
    expect(
      await databaseAdapter.getUserById(bootstrapped.user.id)
    ).not.toBeNull();
    expect(
      await databaseAdapter.getBrowserSessionBySessionTokenHash(
        "token_permanent_delete"
      )
    ).toMatchObject({ activeOrgId: null });
    await expect(access(orgDir)).rejects.toThrow();
    await expect(access(retiredDir)).rejects.toThrow();
    expect(await readFile(join(keptRetired, "private.txt"), "utf8")).toBe(
      "kept data"
    );
  });

  test("permanent deletion removes tool secrets from the global config", async () => {
    const { orgService, authService } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-tool-secret-delete" },
    });

    const kept = await orgService.createOrganization(
      { name: "Beta", slug: "beta-tool-secret-delete" },
      bootstrapped.user.id
    );

    // Unrelated sections share the file; the purge must leave them alone.
    await writeParsedConfigIni(
      { web_public_url: "https://acme.example.com" },
      {
        "provider.keep-me": {
          api_key: "sk-keep-provider",
          label: "Keep",
          type: "openai",
        },
        "tool-key.not-an-encoded-section": { api_key: "sk-foreign-shape" },
      }
    );

    const deletedPlan: ToolSetupPlan = {
      description: "Connect the Acme tool",
      id: "setup_deleted_org",
      name: "Acme tool",
      plan: "paste the api key",
      requiresApiKey: true,
      sessionId: "session_deleted_org",
      status: "pending",
    };

    await saveToolApiKey(
      bootstrapped.organization.id,
      "tool_deleted_org",
      "sk-deleted-org-secret"
    );
    await saveToolSetup(bootstrapped.organization.id, deletedPlan);
    await saveToolApiKey(
      kept.organization.id,
      "tool_kept_org",
      "sk-kept-org-secret"
    );
    await saveToolSetup(kept.organization.id, {
      ...deletedPlan,
      id: "setup_kept_org",
      name: "Beta tool",
      sessionId: "session_kept_org",
    });

    await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );
    await orgService.permanentlyDeleteOrganization(
      bootstrapped.organization.id
    );

    expect(
      await loadToolApiKey(bootstrapped.organization.id, "tool_deleted_org")
    ).toBeUndefined();
    await expect(
      loadToolSetup(bootstrapped.organization.id, "setup_deleted_org")
    ).rejects.toMatchObject({ status: 404 });

    const raw = await readFile(getUserConfigPath(), "utf8");
    expect(raw).not.toContain("sk-deleted-org-secret");
    expect(raw).toContain("sk-keep-provider");
    expect(raw).toContain("sk-foreign-shape");
    expect(raw).toContain("web_public_url=https://acme.example.com");
    expect(await loadToolApiKey(kept.organization.id, "tool_kept_org")).toBe(
      "sk-kept-org-secret"
    );
    expect(
      (await loadToolSetup(kept.organization.id, "setup_kept_org")).id
    ).toBe("setup_kept_org");

    // Retention: the purge rewrites in place and keeps no shadow copy of the
    // secret anywhere under the config directory.
    const files = await readdir(getUserConfigDir(), {
      encoding: "utf8",
      recursive: true,
    });

    for (const file of files) {
      let content: string;

      try {
        content = await readFile(join(getUserConfigDir(), file), "utf8");
      } catch {
        continue;
      }

      expect(content).not.toContain("sk-deleted-org-secret");
    }
  });

  test("refuses to permanently delete an active org", async () => {
    const { orgService, databaseAdapter } = createOrgService();

    const created = await orgService.createOrganization({
      name: "Acme",
      slug: "acme-active-delete",
    });

    const orgDir = getOrgConfigDir(created.organization.id);

    await expect(
      orgService.permanentlyDeleteOrganization(created.organization.id)
    ).rejects.toMatchObject({ status: 409 });

    expect(
      await databaseAdapter.getOrganizationById(created.organization.id)
    ).not.toBeNull();
    await expect(access(orgDir)).resolves.toBeNull();
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
      orgService.acceptInvite({ password: "secret123", token: invite.token! })
    ).rejects.toMatchObject({ status: 404 });
  });

  test("rejects member mutators on an archived org and allows them on an active org", async () => {
    const { orgService, authService } = createOrgService();

    const bootstrapped = await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-member-archive" },
    });

    const active = await orgService.createOrganization(
      { name: "Beta", slug: "beta-member-archive" },
      bootstrapped.user.id
    );

    await orgService.archiveOrganization(
      bootstrapped.organization.id,
      bootstrapped.user.id
    );

    await expect(
      orgService.addMember({
        email: "new@acme.com",
        name: "New Member",
        orgId: bootstrapped.organization.id,
        phone: "",
        role: "member",
      })
    ).rejects.toMatchObject({ status: 404 });

    const added = await orgService.addMember({
      email: "active@acme.com",
      name: "Active Member",
      orgId: active.organization.id,
      phone: "",
      role: "member",
    });

    const updated = await orgService.updateMember(
      active.organization.id,
      added.member.userId,
      { role: "viewer" }
    );

    expect(updated.member.role).toBe("viewer");
    await orgService.removeMember(active.organization.id, added.member.userId);
    const listed = await orgService.listMembers(active.organization.id);
    expect(
      listed.members.some((member) => member.userId === added.member.userId)
    ).toBe(false);
  });
});

async function seedTeamParent(db: DatabaseAdapter) {
  const now = new Date().toISOString();
  for (const id of ["org_parent", "org_other"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
  }
  for (const id of ["user_creator", "user_other", "user_viewer"]) {
    await db.createUser({
      createdAt: now,
      email: `${id}@example.com`,
      id,
      passwordHash: "test",
      updatedAt: now,
    });
  }
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_creator",
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "viewer",
    userId: "user_viewer",
  });
  return { name: "Team", requestId: "team-request", slug: "team" };
}

async function seedSharedAgentSelection(
  db: DatabaseAdapter,
  service: OrgService
) {
  await seedTeamParent(db);
  const now = new Date().toISOString();
  for (const id of ["org_team_a", "org_team_b"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      parentOrgId: "org_parent",
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
    await db.upsertOrgMember({
      createdAt: now,
      orgId: id,
      role: "member",
      userId: "user_other",
    });
  }
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_team_a",
    role: "viewer",
    userId: "user_viewer",
  });
  await db.upsertProfile({
    createdAt: now,
    id: "profile_template",
    isDefault: false,
    isSuper: false,
    model: null,
    name: "Template",
    orgId: "org_parent",
    systemPrompt: "Published instructions",
    updatedAt: now,
  });
  return service.publishSharedResource(
    "org_parent",
    { resourceId: "profile_template", resourceKind: "agent" },
    "user_creator"
  );
}

describe("OrgService shared agent selection", () => {
  test("concurrent selection creates one team profile without copying parent work", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);
    const sourceDir = getProfileSoulDir("org_parent", "profile_template");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "MEMORY.md"), "Private parent memory");
    await writeFile(join(sourceDir, "USER.md"), "Private parent user context");
    await writeFile(join(sourceDir, "private.txt"), "Private parent file");
    const selected = await Promise.all(
      Array.from({ length: 8 }, () =>
        orgService.createSharedAgentInstance(
          "org_team_a",
          publication.id,
          "user_other"
        )
      )
    );
    expect(new Set(selected.map((profile) => profile.id)).size).toBe(1);
    const profile = selected[0];
    expect(profile).toMatchObject({
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Template",
      orgId: "org_team_a",
      systemPrompt: "Published instructions",
    });
    expect(profile.id).not.toBe("profile_template");
    expect(
      (await db.listProfilesForOrg("org_team_a")).map((entry) => entry.id)
    ).toEqual([profile.id]);
    expect(await db.getProfileForOrg(profile.id, "org_parent")).toBeNull();
    expect(
      await db.getSharedAgentInstance("org_team_a", profile.id)
    ).toMatchObject({
      publicationId: publication.id,
      sourceOrgId: "org_parent",
      sourceProfileId: "profile_template",
      teamOrgId: "org_team_a",
    });
    const teamDir = getProfileSoulDir("org_team_a", profile.id);
    expect(await readdir(teamDir)).toEqual([]);
    expect(await db.listSessions()).toEqual([]);
    await writeFile(join(teamDir, "MEMORY.md"), "Private team memory");
    await writeFile(join(teamDir, "USER.md"), "Private team user context");
    await writeFile(join(teamDir, "private.txt"), "Private team file");
    expect(
      (
        await orgService.createSharedAgentInstance(
          "org_team_a",
          publication.id,
          "user_other"
        )
      ).id
    ).toBe(profile.id);
    expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
      "Private team memory"
    );
    expect(await readFile(join(teamDir, "USER.md"), "utf8")).toBe(
      "Private team user context"
    );
    expect(await readFile(join(teamDir, "private.txt"), "utf8")).toBe(
      "Private team file"
    );
    const sibling = await orgService.createSharedAgentInstance(
      "org_team_b",
      publication.id,
      "user_other"
    );
    expect(sibling.id).not.toBe(profile.id);
    expect(sibling.orgId).toBe("org_team_b");
    expect(await readdir(getProfileSoulDir("org_team_b", sibling.id))).toEqual(
      []
    );
    expect(await readFile(join(sourceDir, "MEMORY.md"), "utf8")).toBe(
      "Private parent memory"
    );
    expect(await readFile(join(sourceDir, "USER.md"), "utf8")).toBe(
      "Private parent user context"
    );
    expect(await readFile(join(sourceDir, "private.txt"), "utf8")).toBe(
      "Private parent file"
    );
  });

  test("selection requires existing team invocation access and a current agent publication", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);
    for (const [userId, status] of [
      ["user_creator", 404],
      ["user_viewer", 403],
      ["missing", 404],
    ] as const) {
      await expect(
        orgService.createSharedAgentInstance(
          "org_team_a",
          publication.id,
          userId
        )
      ).rejects.toMatchObject({ status });
    }
    const now = new Date().toISOString();
    await db.createUser({
      createdAt: now,
      email: "platform@example.com",
      id: "user_platform",
      isPlatformAdmin: true,
      passwordHash: "test",
      updatedAt: now,
    });
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_platform"
      )
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      orgService.createSharedAgentInstance(
        "org_parent",
        publication.id,
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      orgService.createSharedAgentInstance(
        "org_other",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        "profile_template",
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
    await db.upsertTool({
      createdAt: now,
      description: "Test",
      handlerConfig: {},
      handlerType: "bash",
      id: "tool_parent",
      name: "parent-tool",
      orgId: "org_parent",
      updatedAt: now,
    });
    const toolPublication = await orgService.publishSharedResource(
      "org_parent",
      { resourceId: "tool_parent", resourceKind: "tool" },
      "user_creator"
    );
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        toolPublication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
    await db.assignToolToProfile("profile_template", "tool_parent");
    await orgService.unpublishSharedResource(
      "org_parent",
      toolPublication.id,
      "user_creator"
    );
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.listProfilesForOrg("org_team_a")).toEqual([]);
    await orgService.publishSharedResource(
      "org_parent",
      { resourceId: "tool_parent", resourceKind: "tool" },
      "user_creator"
    );
    const profile = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );
    await orgService.unpublishSharedResource(
      "org_parent",
      publication.id,
      "user_creator"
    );
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
    expect((await db.getProfileForOrg(profile.id, "org_team_a"))?.id).toBe(
      profile.id
    );
    const republished = await orgService.publishSharedResource(
      "org_parent",
      { resourceId: "profile_template", resourceKind: "agent" },
      "user_creator"
    );
    expect(republished.id).not.toBe(publication.id);
    expect(
      (
        await orgService.createSharedAgentInstance(
          "org_team_a",
          republished.id,
          "user_other"
        )
      ).id
    ).toBe(profile.id);
    expect(
      (await db.getSharedAgentInstance("org_team_a", profile.id))?.publicationId
    ).toBe(republished.id);
    await db.disableUser("user_other", now);
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        republished.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  test("workspace failure keeps the stable record for retry and rejects links outside the team", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);
    const profilesDir = join(getOrgConfigDir("org_team_a"), "profiles");
    await mkdir(getOrgConfigDir("org_team_a"), { recursive: true });
    await writeFile(profilesDir, "Blocks setup");
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 500 });
    const [stored] = await db.listProfilesForOrg("org_team_a");
    expect(stored).toBeTruthy();
    await rm(profilesDir);
    const recovered = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );
    expect(recovered.id).toBe(stored.id);
    const teamDir = getProfileSoulDir("org_team_a", stored.id);
    const foreignDir = getProfileSoulDir("org_parent", "profile_template");
    await mkdir(foreignDir, { recursive: true });
    await writeFile(join(foreignDir, "MEMORY.md"), "Private source memory");
    await rm(teamDir, { recursive: true });
    await symlink(foreignDir, teamDir);
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 500 });
    expect(await readFile(join(foreignDir, "MEMORY.md"), "utf8")).toBe(
      "Private source memory"
    );
    await rm(teamDir);
    expect(
      (
        await orgService.createSharedAgentInstance(
          "org_team_a",
          publication.id,
          "user_other"
        )
      ).id
    ).toBe(stored.id);
    expect(await readdir(teamDir)).toEqual([]);
    expect((await db.listProfilesForOrg("org_team_a")).length).toBe(1);
  });

  test("pending and archived teams cannot create shared instances at either write boundary", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);
    const now = new Date().toISOString();
    await db.beginOrgTeamCreation({
      adminUserId: "user_other",
      creatorUserId: "user_creator",
      organization: {
        createdAt: now,
        id: "org_pending",
        name: "Pending",
        parentOrgId: "org_parent",
        slug: "pending",
        updatedAt: now,
      },
      requestHash: "hash",
      requestId: "pending",
    });
    await expect(
      orgService.createSharedAgentInstance(
        "org_pending",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      db.createSharedAgentInstance(
        "org_pending",
        publication.id,
        "pending_profile",
        now
      )
    ).rejects.toThrow();
    expect(await db.listProfilesForOrg("org_pending")).toEqual([]);
    const team = await db.getOrganizationById("org_team_a");
    await db.upsertOrganization({ ...team!, archivedAt: now });
    await expect(
      orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      db.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "archived_profile",
        now
      )
    ).rejects.toThrow();
    expect(await db.listProfilesForOrg("org_team_a")).toEqual([]);
  });
});

describe("OrgService shared resource publications", () => {
  test("agent publication requires published assignments and preserves private source files", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const now = new Date().toISOString();
    const profile = {
      createdAt: now,
      id: "profile_template",
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Template",
      orgId: "org_parent",
      systemPrompt: "Instructions",
      updatedAt: now,
    };
    await db.upsertProfile(profile);
    const soulDir = getProfileSoulDir("org_parent", profile.id);
    await mkdir(soulDir, { recursive: true });
    await writeFile(join(soulDir, "MEMORY.md"), "Private source memory");
    const tool = {
      createdAt: now,
      description: "Test",
      handlerConfig: {},
      handlerType: "bash",
      id: "tool_template",
      name: "template-tool",
      orgId: "org_parent",
      updatedAt: now,
    };
    await db.upsertTool(tool);
    await db.assignToolToProfile(profile.id, tool.id);
    const request = { resourceId: profile.id, resourceKind: "agent" as const };
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
    await orgService.publishSharedResource(
      "org_parent",
      { resourceId: tool.id, resourceKind: "tool" },
      "user_creator"
    );
    const skillPath = resolveProfileSkillDirectory(
      "org_parent",
      profile.id,
      "template-skill"
    );
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: template-skill\ndescription: Test\n---\nInstructions"
    );
    const skill = {
      createdAt: now,
      createdBy: "human" as const,
      description: "Test",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_template",
      name: "template-skill",
      orgId: "org_parent",
      sourcePath: skillPath,
      updatedAt: now,
    };
    await db.upsertSkill(skill);
    await db.assignSkillToProfile(profile.id, skill.id);
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
    await orgService.publishSharedResource(
      "org_parent",
      { resourceId: skill.id, resourceKind: "skill" },
      "user_creator"
    );
    const { document } = await uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      {
        data: Buffer.from("Shared knowledge").toString("base64"),
        filename: "template.txt",
        mediaType: "text/plain",
      }
    );
    await attachSharedKnowledgeBaseDocument(
      "org_parent",
      profile.id,
      document.id
    );
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
    const knowledgePublication = await orgService.publishSharedResource(
      "org_parent",
      { resourceId: document.id, resourceKind: "knowledge" },
      "user_creator"
    );
    const publication = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    expect(
      await orgService.publishSharedResource(
        "org_parent",
        request,
        "user_creator"
      )
    ).toEqual(publication);
    expect(await db.listProfilesForOrg("org_parent")).toHaveLength(1);
    expect(await db.getProfile(profile.id)).toMatchObject(profile);
    expect(await readFile(join(soulDir, "MEMORY.md"), "utf8")).toBe(
      "Private source memory"
    );
    await orgService.unpublishSharedResource(
      "org_parent",
      knowledgePublication.id,
      "user_creator"
    );
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
    await orgService.publishSharedResource(
      "org_parent",
      { resourceId: document.id, resourceKind: "knowledge" },
      "user_creator"
    );
    await db.upsertSkill({ ...skill, enabled: false });
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
    await db.upsertSkill(skill);
    await rm(join(skillPath, "SKILL.md"));
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 404 });
    await db.unassignSkillFromProfile(profile.id, skill.id);
    await uploadKnowledgeBaseDocument("org_parent", profile.id, {
      data: Buffer.from("Private knowledge").toString("base64"),
      filename: "private.txt",
      mediaType: "text/plain",
    });
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
  });

  test("agent publication rejects protected profiles, conflicting names, and parent connections", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const now = new Date().toISOString();
    const profile = {
      createdAt: now,
      id: "profile_template",
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Template",
      orgId: "org_parent",
      systemPrompt: "",
      updatedAt: now,
    };
    const request = { resourceId: profile.id, resourceKind: "agent" as const };
    for (const changes of [
      { orgId: "org_other" },
      { isDefault: true },
      { isSuper: true },
    ]) {
      await db.upsertProfile({ ...profile, ...changes });
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 404 });
    }
    for (const changes of [
      { acpAgent: { args: ["--token", "parent-secret"], command: "agent" } },
      { acpSettings: { token: "parent-secret" } },
    ]) {
      await db.upsertProfile({ ...profile, ...changes });
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 409 });
      expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
    }
    await db.upsertProfile(profile);
    const globalTool = {
      createdAt: now,
      description: "Test",
      handlerConfig: {},
      handlerType: "bash",
      id: "tool_global",
      name: "same-name",
      orgId: null,
      updatedAt: now,
    };
    await db.upsertTool(globalTool);
    await db.assignToolToProfile(profile.id, globalTool.id);
    await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    const parentTool = {
      ...globalTool,
      id: "tool_parent",
      orgId: "org_parent",
    };
    await db.upsertTool(parentTool);
    await orgService.publishSharedResource(
      "org_parent",
      { resourceId: parentTool.id, resourceKind: "tool" },
      "user_creator"
    );
    await db.assignToolToProfile(profile.id, parentTool.id);
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 409 });
    await db.unassignToolFromProfile(profile.id, parentTool.id);
    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "test", env: { TOKEN: "private" } },
      createdAt: now,
      enabled: true,
      id: "mcp_parent",
      lastError: null,
      name: "Parent connection",
      orgId: "org_parent",
      status: "disconnected",
      transport: "stdio",
      updatedAt: now,
    });
    await db.assignMcpServerToProfile(profile.id, "mcp_parent");
    const server = await db.getMcpServer("mcp_parent");
    expect(server).toBeTruthy();
    await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    const scopedServer = spyOn(
      db,
      "listMcpServersForProfile"
    ).mockResolvedValueOnce([{ ...server!, orgId: "org_parent" }]);
    try {
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      scopedServer.mockRestore();
    }
    await db.unassignMcpServerFromProfile(profile.id, "mcp_parent");
    await db.upsertProfile({
      ...profile,
      model: "missing-provider::missing-model",
    });
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_viewer")
    ).rejects.toMatchObject({ status: 403 });
  });

  test("model publications retain provider identity and require current configured selections", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const providers = ["provider_first", "provider_second"].map((id) => ({
      apiKey: "private-provider-key",
      baseUrl: "http://localhost:11434/v1",
      createdAt: new Date().toISOString(),
      customModels: [{ default: true, id: "same-model", name: "Same model" }],
      id,
      label: id,
      type: "ollama" as const,
    }));
    const config = {
      defaultProviderId: providers[0]!.id,
      providers,
      thinkingEffort: "medium" as const,
      thinkingEnabled: true,
    };
    await saveUserConfig(config);
    const sourceConfig = await readFile(getUserConfigPath());
    const first = await orgService.publishSharedResource(
      "org_parent",
      {
        resourceId: "provider_first::same-model",
        resourceKind: "model",
      },
      "user_creator"
    );
    const retry = await orgService.publishSharedResource(
      "org_parent",
      {
        resourceId: " provider_first:: same-model ",
        resourceKind: "model",
      },
      "user_creator"
    );
    expect(retry).toEqual(first);
    const second = await orgService.publishSharedResource(
      "org_parent",
      {
        resourceId: "provider_second::same-model",
        resourceKind: "model",
      },
      "user_creator"
    );
    expect(second.id).not.toBe(first.id);
    expect(second.resourceId).toBe("provider_second::same-model");
    expect(Object.keys(first).sort()).toEqual([
      "createdAt",
      "id",
      "orgId",
      "resourceId",
      "resourceKind",
      "updatedAt",
    ]);
    for (const resourceId of [
      "",
      "same-model",
      "::same-model",
      "__unknown__::same-model",
      "missing-provider::same-model",
      "provider_first::",
      "provider_first::missing-model",
    ]) {
      await expect(
        orgService.publishSharedResource(
          "org_parent",
          {
            resourceId,
            resourceKind: "model",
          },
          "user_creator"
        )
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      orgService.publishSharedResource(
        "org_parent",
        {
          resourceId: first.resourceId,
          resourceKind: "model",
        },
        "user_viewer"
      )
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.listOrgSharedResources("org_parent")).toHaveLength(2);
    await orgService.unpublishSharedResource(
      "org_parent",
      first.id,
      "user_creator"
    );
    expect(await readFile(getUserConfigPath())).toEqual(sourceConfig);
    const currentConfig = await loadUserConfig();
    expect(
      modelExistsOnInstance(currentConfig!.providers[0]!, "same-model")
    ).toBe(true);
    await saveUserConfig({ ...config, providers: [providers[1]!] });
    await expect(
      orgService.publishSharedResource(
        "org_parent",
        {
          resourceId: first.resourceId,
          resourceKind: "model",
        },
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 400 });
    await saveUserConfig({
      ...config,
      providers: [{ ...providers[1]!, customModels: [{ id: "replacement" }] }],
    });
    await expect(
      orgService.publishSharedResource(
        "org_parent",
        {
          resourceId: second.resourceId,
          resourceKind: "model",
        },
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.listOrgSharedResources("org_parent")).toEqual([second]);
  });

  test("tools require parent ownership or global scope and keep source configuration", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const now = new Date().toISOString();
    for (const orgId of ["org_parent", "org_other", null]) {
      const id = `tool_${orgId ?? "global"}`;
      await db.upsertTool({
        createdAt: now,
        description: "Test tool",
        handlerConfig: { command: "test" },
        handlerType: "bash",
        id,
        name: id,
        orgId,
        updatedAt: now,
      });
    }
    for (const resourceId of ["tool_org_parent", "tool_global"]) {
      const request = { resourceId, resourceKind: "tool" as const };
      const publication = await orgService.publishSharedResource(
        "org_parent",
        request,
        "user_creator"
      );
      expect(
        await orgService.publishSharedResource(
          "org_parent",
          request,
          "user_creator"
        )
      ).toEqual(publication);
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );
      expect((await db.getTool(resourceId))?.handlerConfig).toEqual({
        command: "test",
      });
    }
    for (const resourceId of ["tool_org_other", "missing"]) {
      await expect(
        orgService.publishSharedResource(
          "org_parent",
          { resourceId, resourceKind: "tool" },
          "user_creator"
        )
      ).rejects.toMatchObject({ status: 404 });
    }
    await expect(
      orgService.publishSharedResource(
        "org_parent",
        { resourceId: "tool_org_parent", resourceKind: "tool" },
        "user_viewer"
      )
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
  });

  test("skills require an enabled parent profile source with matching valid content", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const now = new Date().toISOString();
    const profileId = `profile_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.upsertProfile({
      createdAt: now,
      id: profileId,
      isSuper: false,
      model: null,
      name: "Source",
      orgId: "org_parent",
      systemPrompt: "",
      updatedAt: now,
    });
    const sourcePath = resolveProfileSkillDirectory(
      "org_parent",
      profileId,
      "shared-skill"
    );
    const content =
      "---\nname: shared-skill\ndescription: Test skill\n---\nUse this skill.\n";
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "SKILL.md"), content);
    const skill = {
      createdAt: now,
      createdBy: "human" as const,
      description: "Test skill",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_parent",
      name: "shared-skill",
      orgId: "org_parent",
      sourcePath,
      updatedAt: now,
    };
    await db.upsertSkill(skill);
    const request = { resourceId: skill.id, resourceKind: "skill" as const };
    const publication = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    expect(
      await orgService.publishSharedResource(
        "org_parent",
        request,
        "user_creator"
      )
    ).toEqual(publication);
    await orgService.unpublishSharedResource(
      "org_parent",
      publication.id,
      "user_creator"
    );
    expect(await readFile(join(sourcePath, "SKILL.md"), "utf8")).toBe(content);
    for (const changes of [
      { enabled: false },
      { orgId: "org_other" },
      { orgId: null },
      { sourcePath: join(sourcePath, "..", ".archive", "shared-skill") },
      {
        sourcePath: resolveProfileSkillDirectory(
          "org_parent",
          "missing-profile",
          skill.name
        ),
      },
    ]) {
      await db.upsertSkill({ ...skill, ...changes });
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 404 });
    }
    await db.upsertSkill(skill);
    for (const invalid of [
      "",
      "invalid",
      content.replace("name: shared-skill", "name: other-skill"),
    ]) {
      await writeFile(join(sourcePath, "SKILL.md"), invalid);
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 404 });
    }
    await rm(join(sourcePath, "SKILL.md"));
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 404 });
    if (process.platform !== "win32") {
      const foreignFile = join(getOrgConfigDir("org_other"), `${profileId}.md`);
      await mkdir(getOrgConfigDir("org_other"), { recursive: true });
      await writeFile(foreignFile, content);
      await symlink(foreignFile, join(sourcePath, "SKILL.md"));
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 404 });
      expect(await readFile(foreignFile, "utf8")).toBe(content);
      await rm(sourcePath, { recursive: true });
      const foreignDirectory = join(getOrgConfigDir("org_other"), profileId);
      await mkdir(foreignDirectory, { recursive: true });
      await writeFile(join(foreignDirectory, "SKILL.md"), content);
      await symlink(foreignDirectory, sourcePath);
      await expect(
        orgService.publishSharedResource("org_parent", request, "user_creator")
      ).rejects.toMatchObject({ status: 404 });
      expect(await readFile(join(foreignDirectory, "SKILL.md"), "utf8")).toBe(
        content
      );
    }
    expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
  });

  const source = () => ({
    data: Buffer.from(crypto.randomUUID()).toString("base64"),
    filename: `${crypto.randomUUID()}.txt`,
    mediaType: "text/plain",
  });

  test("publication is explicit, stable on retry, and removal preserves the source", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const attachment = source();
    const { document } = await uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      attachment
    );
    const request = {
      resourceId: document.id,
      resourceKind: "knowledge" as const,
    };
    expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
    const publication = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    const retried = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    expect(retried.id).toBe(publication.id);
    expect(await db.listOrgSharedResources("org_parent")).toHaveLength(1);
    expect(publication).toMatchObject({ orgId: "org_parent", ...request });
    expect(
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      )
    ).toBe(true);
    expect(
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      )
    ).toBe(false);
    await expect(
      readFile(
        getKnowledgeBaseStoredDocumentPath(
          getOrgKnowledgeBaseDir("org_parent"),
          document.id,
          document.filename
        )
      )
    ).resolves.toEqual(Buffer.from(attachment.data, "base64"));
    const republished = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    expect(republished.id).not.toBe(publication.id);
  });

  test("parent members, viewers, unrelated users, and team admins cannot publish or remove parent documents", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const now = new Date().toISOString();
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_parent",
      role: "member",
      userId: "user_other",
    });
    await db.upsertOrganization({
      createdAt: now,
      id: "org_team",
      name: "Team",
      parentOrgId: "org_parent",
      slug: "publication-team",
      updatedAt: now,
    });
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_team",
      role: "admin",
      userId: "user_other",
    });
    const { document } = await uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      source()
    );
    const request = {
      resourceId: document.id,
      resourceKind: "knowledge" as const,
    };
    const publication = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_creator"
    );
    for (const actor of ["user_viewer", "user_other", "user_missing"]) {
      await expect(
        orgService.publishSharedResource("org_parent", request, actor)
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        orgService.unpublishSharedResource("org_parent", publication.id, actor)
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      orgService.publishSharedResource("org_team", request, "user_other")
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.listOrgSharedResources("org_parent")).toEqual([
      publication,
    ]);
    expect(await db.listOrgSharedResources("org_team")).toEqual([]);
  });

  test("platform admins may publish, but disabled admins and archived parents cannot", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const now = new Date().toISOString();
    await db.createUser({
      createdAt: now,
      email: "publication-platform@example.com",
      id: "user_platform",
      isPlatformAdmin: true,
      passwordHash: "test",
      updatedAt: now,
    });
    const { document } = await uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      source()
    );
    const request = {
      resourceId: document.id,
      resourceKind: "knowledge" as const,
    };
    const publication = await orgService.publishSharedResource(
      "org_parent",
      request,
      "user_platform"
    );
    expect(
      await orgService.unpublishSharedResource(
        "org_other",
        publication.id,
        "user_platform"
      )
    ).toBe(false);
    await db.disableUser("user_platform", now);
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_platform")
    ).rejects.toMatchObject({ status: 403 });
    await orgService.archiveOrganization("org_parent");
    await expect(
      orgService.publishSharedResource("org_parent", request, "user_creator")
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  test("foreign, profile-owned, missing, and failed documents leave publications unchanged", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const foreign = await uploadOrganizationKnowledgeBaseDocument(
      "org_other",
      source()
    );
    const profile = await uploadKnowledgeBaseDocument(
      "org_parent",
      "profile_private",
      source()
    );
    const missing = await uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      source()
    );
    await rm(
      getKnowledgeBaseStoredDocumentPath(
        getOrgKnowledgeBaseDir("org_parent"),
        missing.document.id,
        missing.document.filename
      )
    );
    const failed = await uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      source()
    );
    const manifestPath = getKnowledgeBaseManifestPath(
      getOrgKnowledgeBaseDir("org_parent")
    );
    const documents =
      await listOrganizationKnowledgeBaseDocuments("org_parent");
    await writeFile(
      manifestPath,
      JSON.stringify({
        documents: documents.map((document) =>
          document.id === failed.document.id
            ? { ...document, status: "failed" }
            : document
        ),
      })
    );
    for (const resourceId of [
      foreign.document.id,
      profile.document.id,
      missing.document.id,
      failed.document.id,
      "missing",
    ]) {
      await expect(
        orgService.publishSharedResource(
          "org_parent",
          { resourceId, resourceKind: "knowledge" },
          "user_creator"
        )
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
  });

  test.skipIf(process.platform === "win32")(
    "documents linked outside the parent knowledge store cannot be published",
    async () => {
      const { orgService, databaseAdapter: db } = createOrgService();
      await seedTeamParent(db);
      const { document } = await uploadOrganizationKnowledgeBaseDocument(
        "org_parent",
        source()
      );
      const stored = getKnowledgeBaseStoredDocumentPath(
        getOrgKnowledgeBaseDir("org_parent"),
        document.id,
        document.filename
      );
      const privatePath = join(getOrgConfigDir("org_other"), "private.txt");
      await mkdir(getOrgConfigDir("org_other"), { recursive: true });
      await writeFile(privatePath, "private");
      await rm(stored);
      await symlink(privatePath, stored);
      await expect(
        orgService.publishSharedResource(
          "org_parent",
          { resourceId: document.id, resourceKind: "knowledge" },
          "user_creator"
        )
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
      expect(await readFile(privatePath, "utf8")).toBe("private");
    }
  );
});

describe("OrgService team setup", () => {
  test("concurrent and later retries return one fully seeded team", async () => {
    const { orgService, databaseAdapter } = createOrgService();
    const request = await seedTeamParent(databaseAdapter);
    const [first, retry] = await Promise.all([
      orgService.createTeam("org_parent", request, "user_creator"),
      orgService.createTeam("org_parent", request, "user_creator"),
    ]);
    expect(retry.organization.id).toBe(first.organization.id);
    expect(
      (await orgService.createTeam("org_parent", request, "user_creator"))
        .organization.id
    ).toBe(first.organization.id);
    expect(first.adminMember?.member.userId).toBe("user_creator");
    expect(first.adminMember?.temporaryPassword).toBeNull();
    const team = await databaseAdapter.getOrganizationById(
      first.organization.id
    );
    expect(team?.parentOrgId).toBe("org_parent");
    expect(team?.setupPending).toBe(false);
    const profiles = await databaseAdapter.listProfilesForOrg(
      first.organization.id
    );
    expect(profiles).toHaveLength(2);
    expect(profiles.some((profile) => profile.isDefault)).toBe(true);
    expect(profiles.some((profile) => profile.isSuper)).toBe(true);
    for (const profile of profiles) {
      expect(
        await readFile(
          join(getProfileSoulDir(first.organization.id, profile.id), "SOUL.md"),
          "utf8"
        )
      ).toBeTruthy();
    }
    await expect(
      orgService.createTeam(
        "org_parent",
        { ...request, name: "Changed" },
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      orgService.createTeam(
        first.organization.id,
        { ...request, requestId: "nested", slug: "nested" },
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      orgService.archiveOrganization("org_parent")
    ).rejects.toMatchObject({ status: 409 });
  });

  test("another first admin gets team access without adding the creator", async () => {
    const { orgService, databaseAdapter } = createOrgService();
    const request = await seedTeamParent(databaseAdapter);
    const created = await orgService.createTeam(
      "org_parent",
      { ...request, adminUserId: "user_other" },
      "user_creator"
    );
    expect(created.adminMember?.member.userId).toBe("user_other");
    expect(
      await databaseAdapter.getOrgMember(
        created.organization.id,
        "user_creator"
      )
    ).toBeNull();
    expect(
      (
        await databaseAdapter.getOrgMember(
          created.organization.id,
          "user_other"
        )
      )?.role
    ).toBe("admin");
    await expect(
      orgService.setActiveOrg({
        orgId: created.organization.id,
        userId: "user_creator",
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await orgService.setActiveOrg({
          orgId: created.organization.id,
          userId: "user_other",
        })
      ).id
    ).toBe(created.organization.id);
    for (const actor of ["user_viewer", "user_other", "missing"]) {
      await expect(
        orgService.createTeam(
          "org_parent",
          { ...request, requestId: actor, slug: actor.replace(/_/g, "-") },
          actor
        )
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      orgService.createTeam(
        "org_parent",
        {
          ...request,
          adminUserId: "missing",
          requestId: "invalid-admin",
          slug: "invalid-admin",
        },
        "user_creator"
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await databaseAdapter.listOrganizations()).filter(
        (org) => org.parentOrgId === "org_parent"
      )
    ).toHaveLength(1);
  });

  test.each(["seed", "complete"])(
    "failed %s cleans only the new team and permits retry",
    async (stage) => {
      const { orgService, databaseAdapter } = createOrgService();
      const request = await seedTeamParent(databaseAdapter);
      await mkdir(getOrgConfigDir("org_parent"), { recursive: true });
      const parentFile = join(getOrgConfigDir("org_parent"), "private.txt");
      await writeFile(parentFile, "Parent private data");
      let failedTeamId = "";
      const original = databaseAdapter.upsertProfile.bind(databaseAdapter);
      const profileSpy = spyOn(
        databaseAdapter,
        "upsertProfile"
      ).mockImplementation(async (profile) => {
        failedTeamId = profile.orgId ?? "";
        if (stage === "seed" && profile.isSuper) {
          throw new Error("Injected profile failure");
        }
        await original(profile);
      });
      const completeSpy =
        stage === "complete"
          ? spyOn(
              databaseAdapter,
              "completeOrgTeamCreation"
            ).mockResolvedValueOnce(false)
          : null;
      try {
        await expect(
          orgService.createTeam("org_parent", request, "user_creator")
        ).rejects.toThrow();
      } finally {
        profileSpy.mockRestore();
        completeSpy?.mockRestore();
      }
      expect(failedTeamId).toBeTruthy();
      expect(
        await databaseAdapter.getOrganizationById(failedTeamId)
      ).toBeNull();
      expect(await databaseAdapter.listProfilesForOrg(failedTeamId)).toEqual(
        []
      );
      expect(
        await databaseAdapter.getOrgTeamCreation(
          "org_parent",
          request.requestId
        )
      ).toBeNull();
      await expect(access(getOrgConfigDir(failedTeamId))).rejects.toThrow();
      expect(await readFile(parentFile, "utf8")).toBe("Parent private data");
      expect(await databaseAdapter.getUserById("user_creator")).not.toBeNull();
      const retry = await orgService.createTeam(
        "org_parent",
        request,
        "user_creator"
      );
      expect(
        (await databaseAdapter.getOrganizationById(retry.organization.id))
          ?.setupPending
      ).toBe(false);
      expect(
        (await databaseAdapter.listOrganizations()).filter(
          (org) => org.parentOrgId === "org_parent"
        )
      ).toHaveLength(1);
    }
  );

  test("a failed cleanup keeps the request recoverable with the same team ID", async () => {
    const { orgService, databaseAdapter } = createOrgService();
    const request = await seedTeamParent(databaseAdapter);
    const completion = spyOn(
      databaseAdapter,
      "completeOrgTeamCreation"
    ).mockResolvedValueOnce(false);
    const cleanup = spyOn(
      databaseAdapter,
      "abortOrgTeamCreation"
    ).mockRejectedValueOnce(new Error("Injected cleanup failure"));
    try {
      await expect(
        orgService.createTeam("org_parent", request, "user_creator")
      ).rejects.toThrow();
    } finally {
      completion.mockRestore();
      cleanup.mockRestore();
    }
    const pending = await databaseAdapter.getOrgTeamCreation(
      "org_parent",
      request.requestId
    );
    expect(pending?.completedAt).toBeNull();
    expect(pending?.teamOrgId).toBeTruthy();
    expect(
      (await databaseAdapter.getOrganizationById(pending!.teamOrgId))
        ?.setupPending
    ).toBe(true);
    const retry = await orgService.createTeam(
      "org_parent",
      request,
      "user_creator"
    );
    expect(retry.organization.id).toBe(pending!.teamOrgId);
    expect(
      await databaseAdapter.listProfilesForOrg(retry.organization.id)
    ).toHaveLength(2);
    expect(
      (await databaseAdapter.getOrganizationById(retry.organization.id))
        ?.setupPending
    ).toBe(false);
  });

  test("pending teams cannot switch or update; parent deletion preserves files while children remain", async () => {
    const { orgService, databaseAdapter } = createOrgService();
    const request = await seedTeamParent(databaseAdapter);
    const now = new Date().toISOString();
    await databaseAdapter.beginOrgTeamCreation({
      adminUserId: "user_creator",
      creatorUserId: "user_creator",
      organization: {
        createdAt: now,
        id: "org_pending",
        name: "Pending",
        parentOrgId: "org_parent",
        slug: "pending",
        updatedAt: now,
      },
      requestHash: "hash",
      requestId: request.requestId,
    });
    await expect(
      orgService.setActiveOrg({ orgId: "org_pending", userId: "user_creator" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      orgService.updateOrganization("org_pending", { name: "Changed" })
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await orgService.listOrganizations()).some(
        (org) => org.id === "org_pending"
      )
    ).toBe(false);
    await databaseAdapter.abortOrgTeamCreation(
      "org_parent",
      request.requestId,
      "org_pending"
    );
    const created = await orgService.createTeam(
      "org_parent",
      request,
      "user_creator"
    );
    await orgService.archiveOrganization(created.organization.id);
    await orgService.archiveOrganization("org_parent");
    await mkdir(getOrgConfigDir("org_parent"), { recursive: true });
    const parentFile = join(getOrgConfigDir("org_parent"), "private.txt");
    await writeFile(parentFile, "Parent data");
    await expect(
      orgService.permanentlyDeleteOrganization("org_parent")
    ).rejects.toMatchObject({ status: 409 });
    expect(await readFile(parentFile, "utf8")).toBe("Parent data");
  });
});
