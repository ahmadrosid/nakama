import { describe, expect, spyOn, test } from "bun:test";
import {
  access,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  attachSharedKnowledgeBaseDocument,
  type EmailOutboundAdapter,
  type GenerateChatInput,
  getCustomToolsDir,
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
  type UserConfig,
  uploadKnowledgeBaseDocument,
  uploadOrganizationKnowledgeBaseDocument,
  writeParsedConfigIni,
} from "@nakama/core";
import {
  LOCAL_CLIENT_USER_ID,
  resolveLocalAuthToken,
} from "@nakama/core/local-auth";
import {
  createDatabase,
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
  mergeWorkspaceSettings,
  type StoredProfileRecord,
} from "@nakama/db";
import { NakamaClient } from "../../../../packages/client/src/client";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { loginUserSession } from "../http/test-session-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { AuthService } from "./auth-service";
import { AutomationRunner } from "./automation-runner";
import { AutomationService } from "./automation-service";
import { enrichCodingAgentBashInput } from "./coding-agent-bash-env";
import {
  deleteOrgToolCredentials,
  loadToolApiKey,
  loadToolSetup,
  saveToolApiKey,
  saveToolEnv,
  saveToolSetup,
} from "./custom-tool-shared";
import {
  createNakamaDataExport,
  restoreNakamaDataImport,
} from "./data-portability";
import { McpClientManager } from "./mcp-client-manager";
import { McpService } from "./mcp-service";
import { OrgService } from "./org-service";
import { OrgUsageQuotaService } from "./org-usage-quota-service";
import { ProfileService } from "./profile-service";
import { modelExistsOnInstance } from "./provider-instance-helpers";
import { sessionTurnRegistry } from "./session-turn-registry";
import { isSkillWriteApprovalRequired } from "./skill-write-approval";

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

    for (const allowedInviteDomains of [["*.acme.com"], [""], "acme.com"]) {
      await expect(
        orgService.updateOrganization(created.organization.id, {
          // @ts-expect-error A string tests runtime validation of the array contract.
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
        (profile) => profile.isSuper && profile.name === "Super Nakama"
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
      role: "member",
    });

    expect(invite.delivered).toBe(true);
    expect(invite.token).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("guest@acme.com");
    expect(sent[0]?.subject).toBe("You're invited to Acme");
    expect(sent[0]?.text).toContain(
      "https://nakama.example.com/accept-invite?token="
    );
    expect(sent[0]?.text).toContain("join Acme as member");
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
      email: "member@acme.com",
      name: "Member One",
      orgId: created.organization.id,
      phone: "+628111111111",
      role: "member",
    });

    const listed = await orgService.listMembers(created.organization.id);
    expect(listed.members).toHaveLength(2);
    expect(listed.members.map((member) => member.email).sort()).toEqual([
      "admin@acme.com",
      "member@acme.com",
    ]);

    const updated = await orgService.updateMember(
      created.organization.id,
      added.member.userId,
      {
        name: "Member Prime",
        phone: "+628222333444",
        role: "member",
      }
    );

    expect(updated.member.name).toBe("Member Prime");
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

  // The member list is where an admin sees who is locked out; without the
  // field the web cannot offer Enable for a disabled account.
  test("the member list shows when an account is disabled, and clears it on enable", async () => {
    const { orgService } = createOrgService();

    const created = await orgService.createOrganization({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        phone: "+628123456789",
      },
      name: "Acme",
      slug: "acme-disabled-list",
    });

    const orgId = created.organization.id;

    const added = await orgService.addMember({
      email: "member@acme.com",
      name: "Member",
      orgId,
      phone: "+628987654321",
      role: "member",
    });

    const userId = added.member.userId;

    const disabledAtFor = async () =>
      (await orgService.listMembers(orgId)).members.find(
        (member) => member.userId === userId
      )?.disabledAt;

    expect(await disabledAtFor()).toBeNull();

    await orgService.disableMember(orgId, userId);
    expect(await disabledAtFor()).toEqual(expect.any(String));

    await orgService.enableMember(orgId, userId);
    expect(await disabledAtFor()).toBeNull();
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
      { role: "member" }
    );

    expect(updated.member.role).toBe("member");
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

  for (const id of ["user_creator", "user_other", "user_secondary_member"]) {
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
    role: "member",
    userId: "user_secondary_member",
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
    role: "member",
    userId: "user_secondary_member",
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
  test.each(["stored", "ephemeral", "automation"] as const)(
    "shared %s turns use only the executing team's quota and usage",
    async (mode) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const parent = (await db.getOrganizationById("org_parent"))!;
      const team = (await db.getOrganizationById("org_team_a"))!;
      await db.upsertOrganization({ ...parent, monthlyLlmTurnLimit: 1 });
      await db.upsertOrganization({ ...team, monthlyLlmTurnLimit: 1 });
      await db.incrementLlmTurnUsage("org_parent", {
        estimated: false,
        inputTokens: 1,
        outputTokens: 1,
      });
      const parentUsage = await db.listLlmTurnUsage("org_parent");
      const quotas = new OrgUsageQuotaService(db);
      expect((await quotas.getStatus("org_parent")).status).toBe("blocked");
      let providerCalls = 0;

      const provider = {
        generateChat: async () => {
          providerCalls += 1;

          return {
            assistantMessage: { content: "Done", role: "assistant" as const },
            content: "Done",
            toolCalls: [],
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          };
        },
        name: "test",
        streamChat: async (
          _input: GenerateChatInput,
          handlers: { onChunk: (chunk: string) => void }
        ) => {
          handlers.onChunk("Done");

          return provider.generateChat();
        },
      };

      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({ provider }),
        resolveProfileTools: async () => [],
      });

      const sessionId =
        mode === "automation"
          ? null
          : await agent.createSession(
              "org_team_a",
              "web",
              profile.id,
              "user_other",
              { cognito: mode === "ephemeral", orgRole: "member" }
            );

      const session = sessionId
        ? (await agent.resolveSession(sessionId, "org_team_a"))!
        : null;

      const run = () =>
        session
          ? session.send("Team task")
          : agent.runAutomationPrompt("org_team_a", profile.id, "Team task");

      await run();
      expect(providerCalls).toBe(1);
      expect(await quotas.getStatus("org_team_a")).toMatchObject({
        status: "blocked",
        turns: 1,
      });
      expect((await quotas.getStatus("org_team_a")).tokens).toBeGreaterThan(0);
      expect(await db.listLlmTurnUsage("org_parent")).toEqual(parentUsage);
      expect(await db.listLlmTurnUsage("org_team_b")).toEqual([]);
      await expect(run()).rejects.toMatchObject({ status: 429 });
      expect(providerCalls).toBe(1);
      expect((await quotas.getStatus("org_team_a")).turns).toBe(1);
      await db.upsertOrganization({ ...team, monthlyLlmTurnLimit: 0 });
      await run();
      expect(providerCalls).toBe(2);
      expect((await quotas.getStatus("org_team_a")).turns).toBe(2);
      expect(await db.listLlmTurnUsage("org_parent")).toEqual(parentUsage);
      expect(await db.listLlmTurnUsage("org_team_b")).toEqual([]);
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );
    }
  );
  test("shared automation runs use team state and record revocation failures without provider calls", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);

    const profile = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );

    const teamDir = getProfileSoulDir("org_team_a", profile.id);
    const sourceDir = getProfileSoulDir("org_parent", "profile_template");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(teamDir, "MEMORY.md"), "Team automation memory");
    await writeFile(join(sourceDir, "STYLE.md"), "Published automation style");
    await writeFile(join(sourceDir, "MEMORY.md"), "Private parent memory");
    const builds: StoredProfileRecord[] = [];
    const turns: GenerateChatInput[] = [];

    const provider = {
      generateChat: async (input: GenerateChatInput) => {
        turns.push(input);

        return {
          assistantMessage: { content: "Done", role: "assistant" as const },
          content: "Done",
          toolCalls: [],
        };
      },
      name: "test",
      streamChat: async (
        input: GenerateChatInput,
        handlers: { onChunk: (chunk: string) => void }
      ) => {
        handlers.onChunk("Done");

        return provider.generateChat(input);
      },
    };

    const agent = new AgentService(null, null, db);
    agent.setOrgService(orgService);
    Object.assign(agent, {
      _providerConfigured: true,
      createHarnessForProfile: (settings: StoredProfileRecord) => {
        builds.push(settings);

        return { provider };
      },
      resolveProfileTools: async () => [],
    });

    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      "org_team_a",
      {
        description: "Run the shared agent in its team",
        name: "Shared automation",
        prompt: "Perform the team task",
        trigger: { type: "manual" },
      },
      profile.id
    );

    const runner = new AutomationRunner(service, agent);
    expect(await runner.run(automation.id)).toEqual({ output: "Done" });
    expect(turns).toHaveLength(1);
    expect(builds[0]).toMatchObject({
      id: profile.id,
      orgId: "org_team_a",
      systemPrompt: "Published instructions",
    });
    expect(turns[0]?.system).toContain("Published automation style");
    expect(turns[0]?.system).toContain("Team automation memory");
    expect(turns[0]?.system).not.toContain("Private parent memory");
    const completedRuns = await service.listRuns(automation.id, "org_team_a");
    expect(completedRuns).toHaveLength(1);
    expect(completedRuns[0]).toMatchObject({
      output: "Done",
      status: "completed",
    });
    await orgService.unpublishSharedResource(
      "org_parent",
      publication.id,
      "user_creator"
    );
    expect((await runner.run(automation.id)).error).toBeDefined();
    expect(turns).toHaveLength(1);
    expect(builds).toHaveLength(1);
    const runs = await service.listRuns(automation.id, "org_team_a");
    expect(runs).toHaveLength(2);
    expect(runs.filter((run) => run.status === "failed")).toHaveLength(1);
    expect(runs.find((run) => run.status === "completed")).toEqual(
      completedRuns[0]
    );
    await expect(
      agent.runAutomationPrompt("org_team_b", profile.id, "Foreign task")
    ).rejects.toMatchObject({ status: 404 });
    expect(turns).toHaveLength(1);
    expect(await db.listSessions()).toEqual([]);
    expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
      profile
    );
    expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
      "Team automation memory"
    );
    expect(await readFile(join(sourceDir, "MEMORY.md"), "utf8")).toBe(
      "Private parent memory"
    );
  });
  test.each([false, true])(
    "HTTP shared sessions deny revoked turns for cognito=%s",
    async (cognito) => {
      const {
        orgService,
        databaseAdapter: db,
        authService,
      } = createOrgService();

      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const passwordHash = await authService.hashPassword("password123");

      for (const userId of ["user_other", "user_secondary_member"]) {
        await db.updateUserPassword(
          userId,
          passwordHash,
          new Date().toISOString()
        );
      }

      let providerCalls = 0;
      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat: () => {
              providerCalls += 1;

              return Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              });
            },
            name: "test",
          },
        }),
        resolveProfileTools: async () => [],
      });

      const { app } = createMinimalHonoApp({
        agent,
        authService,
        databaseAdapter: db,
        orgService,
      });

      const member = await loginUserSession(
        app,
        "user_other@example.com",
        "password123",
        "org_team_a"
      );

      const memberHeaders = member.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": member.csrfToken,
      });

      const create = await app.fetch(
        new Request("http://localhost:4310/v1/sessions", {
          body: JSON.stringify({
            channel: "web",
            cognito,
            profileId: profile.id,
          }),
          headers: memberHeaders,
          method: "POST",
        })
      );

      expect(create.status).toBe(201);
      const body: { sessionId: string } = await create.json();
      const id = body.sessionId;
      const session = (await agent.resolveSession(id, "org_team_a"))!;
      await session.send("Saved team turn");
      const history = [...session.getHistory()];
      expect(providerCalls).toBe(1);

      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );

      for (const path of ["/v1/sessions", `/v1/sessions/${id}/messages`]) {
        const response = await app.fetch(
          new Request(`http://localhost:4310${path}`, {
            body: JSON.stringify({
              channel: "web",
              cognito,
              message: "Revoked turn",
              profileId: profile.id,
            }),
            headers: memberHeaders,
            method: "POST",
          })
        );

        expect(response.status).toBe(404);
      }

      expect(providerCalls).toBe(1);
      expect(sessionTurnRegistry.isActive(id)).toBe(false);

      const messages = await app.fetch(
        new Request(`http://localhost:4310/v1/sessions/${id}/messages`, {
          headers: member.headers(),
        })
      );

      expect(messages.status).toBe(200);
      expect(await messages.json()).toMatchObject({ messages: history });

      const foreign = await app.fetch(
        new Request(`http://localhost:4310/v1/sessions/${id}/messages`, {
          headers: member.headers({}, "org_team_b"),
        })
      );

      expect(foreign.status).toBe(404);
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );

      if (cognito) {
        expect(await db.getSession(id)).toBeNull();
        expect(await db.listMessagesForSession(id)).toEqual([]);
      }
    }
  );
  test.each(["cli", "telegram", "discord", "whatsapp", "slack"] as const)(
    "local-token client denies revoked shared sessions for %s",
    async (channel) => {
      const {
        orgService,
        databaseAdapter: db,
        authService,
      } = createOrgService();

      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      let providerCalls = 0;

      const provider = {
        generateChat: () => {
          providerCalls += 1;

          return Promise.resolve({
            assistantMessage: { content: "Done", role: "assistant" as const },
            content: "Done",
            toolCalls: [],
          });
        },
        streamChat: (
          _input: GenerateChatInput,
          handlers: { onChunk: (chunk: string) => void }
        ) => {
          handlers.onChunk("Done");

          return provider.generateChat();
        },
      };

      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({ name: "test", provider }),
        resolveProfileTools: async () => [],
      });

      const { app } = createMinimalHonoApp({
        agent,
        authService,
        databaseAdapter: db,
        orgService,
      });

      const client = new NakamaClient({
        authToken: await resolveLocalAuthToken(),
        baseUrl: "http://localhost:4310",
        fetch: (input, init) =>
          Promise.resolve(app.fetch(new Request(input, init))),
        orgId: "org_team_a",
      });

      const session = await client.createSession(channel, {
        profileId: profile.id,
      });

      expect(await session.send("Saved team turn")).toBe("Done");
      expect(await session.sendStream("Saved streamed turn", () => {})).toBe(
        "Done"
      );
      const history = await session.getMessages();
      expect(history).toHaveLength(4);
      expect(providerCalls).toBe(2);
      expect(await db.getSession(session.id)).toMatchObject({
        channel,
        profileId: profile.id,
        userId: LOCAL_CLIENT_USER_ID,
      });
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );
      await expect(
        client.createSession(channel, { profileId: profile.id })
      ).rejects.toMatchObject({ status: 404 });
      await expect(session.send("Revoked turn")).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        session.sendStream("Revoked streamed turn", () => {})
      ).rejects.toMatchObject({ status: 404 });
      expect(providerCalls).toBe(2);
      expect(sessionTurnRegistry.isActive(session.id)).toBe(false);
      expect(await session.getMessages()).toEqual(history);
      await expect(
        client.forOrg("org_team_b").getSessionMessages(session.id)
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );
    }
  );
  test("restored shared sessions rebuild from restored source settings and saved history", async () => {
    const rootDir = getUserConfigDir();
    const databasePath = join(rootDir, "sqlite", "restore.sqlite");
    const database = await createDatabase(`file:${databasePath}`);
    const db = database.adapter;

    try {
      const now = new Date().toISOString();
      await saveUserConfig({
        defaultProviderId: "restore_provider",
        providers: [
          {
            apiKey: "test",
            createdAt: now,
            id: "restore_provider",
            label: "Restore",
            type: "openai",
          },
        ],
      });
      const orgService = new OrgService(db, new AuthService());
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const teamDir = getProfileSoulDir("org_team_a", profile.id);
      const sourceDir = getProfileSoulDir("org_parent", "profile_template");
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, "STYLE.md"), "Restored source style");
      await writeFile(join(teamDir, "MEMORY.md"), "Restored team memory");
      const builds: StoredProfileRecord[] = [];
      const turns: GenerateChatInput[] = [];
      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: (settings: StoredProfileRecord) => {
          builds.push(settings);

          return {
            provider: {
              generateChat: (input: GenerateChatInput) => {
                turns.push(input);

                return Promise.resolve({
                  assistantMessage: { content: "Done", role: "assistant" },
                  content: "Done",
                  toolCalls: [],
                });
              },
              name: "test",
            },
          };
        },
        resolveProfileTools: async () => [],
      });

      const id = await agent.createSession(
        "org_team_a",
        "web",
        profile.id,
        "user_other",
        { orgRole: "member" }
      );

      const first = (await agent.resolveSession(id, "org_team_a"))!;
      await first.send("Saved turn");
      const savedHistory = [...first.getHistory()];
      const backup = await createNakamaDataExport({ databasePath, rootDir });
      const source = (await db.getProfile("profile_template"))!;
      await db.upsertProfile({
        ...source,
        name: "Later source",
        systemPrompt: "Later instructions",
      });
      await writeFile(join(sourceDir, "STYLE.md"), "Later source style");
      await writeFile(join(teamDir, "MEMORY.md"), "Later team memory");
      const later = (await agent.resolveSession(id, "org_team_a"))!;
      await later.send("Later turn");
      expect(later.getHistory()).toHaveLength(savedHistory.length + 2);
      expect(builds.at(-1)?.name).toBe("Later source");
      await restoreNakamaDataImport(backup.data, {
        beforeReplace: () => database.release(),
        confirm: true,
        databasePath,
        rootDir,
      });
      await database.reopen();
      await agent.reloadAfterDataRestore();
      const restored = (await agent.resolveSession(id, "org_team_a"))!;
      expect(restored).not.toBe(later);
      expect(restored.getHistory()).toEqual(savedHistory);
      expect(builds.at(-1)).toMatchObject({
        id: profile.id,
        name: source.name,
        orgId: "org_team_a",
        systemPrompt: source.systemPrompt,
      });
      await restored.send("Continue after restore");
      expect(turns.at(-1)?.system).toContain("Restored source style");
      expect(turns.at(-1)?.system).toContain("Restored team memory");
      expect(turns.at(-1)?.system).not.toContain("Later source style");
      expect(turns.at(-1)?.system).not.toContain("Later team memory");
      expect(
        (await agent.getSessionMessages(id, "org_team_a"))?.messages
      ).toEqual([...restored.getHistory()]);
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );
      await expect(
        agent.beginSessionTurn(id, "org_team_a")
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await agent.getSessionMessages(id, "org_team_a"))?.messages
      ).toEqual([...restored.getHistory()]);
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );
      expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
        "Restored team memory"
      );
    } finally {
      database.release();
    }
  });
  test("published tool details and local assignments keep parent sources private", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const agentPublication = await seedSharedAgentSelection(db, orgService);
    const service = new ProfileService(db);
    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "local_agent",
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Local",
      orgId: "org_team_a",
      systemPrompt: "",
      updatedAt: now,
    });

    const modulePath = join(
      getCustomToolsDir("org_parent"),
      "published-details.js"
    );

    await mkdir(getCustomToolsDir("org_parent"), { recursive: true });
    await writeFile(
      modulePath,
      'export const parameters = {type: "object", properties: {value: {type: "string"}}}; export async function run(input) {return input;}'
    );

    const record = {
      createdAt: now,
      description: "Probe",
      handlerConfig: {
        env: [{ name: "TOKEN", secret: true }],
        modulePath,
        parameters: {
          properties: { value: { type: "string" } },
          type: "object",
        },
        requiresApiKey: true,
      },
      handlerType: "javascript",
      id: "detail_shared",
      name: "Shared",
      orgId: "org_parent",
      updatedAt: now,
    };

    await db.upsertTool(record);
    await db.upsertTool({ ...record, id: "detail_private", name: "Private" });

    const publication = await orgService.publishSharedResource(
      "org_parent",
      { resourceId: record.id, resourceKind: "tool" },
      "user_creator"
    );

    const detail = (await service.getTool(record.id, "org_team_a")).tool;
    expect(detail).toMatchObject({
      parameters: { properties: { value: { type: "string" } } },
      publicationId: publication.id,
      scope: "parent",
    });
    expect(JSON.stringify(detail)).not.toContain(modulePath);
    await expect(
      service.getTool("detail_private", "org_team_a")
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.getToolSource(record.id, "org_team_a")
    ).rejects.toMatchObject({ status: 404 });

    const assigned = await service.assignTool("org_team_a", "local_agent", {
      toolId: record.id,
    });

    expect(assigned.profile.tools.map((tool) => tool.id)).toContain(record.id);
    expect(await db.getTool(record.id)).toMatchObject({
      handlerConfig: { modulePath },
      orgId: "org_parent",
    });
    expect(
      (await service.listProfileTools("org_team_a", "local_agent")).tools
    ).toMatchObject([{ id: record.id, publicationId: publication.id }]);
    expect(
      JSON.stringify(
        await service.listProfileTools("org_team_a", "local_agent")
      )
    ).not.toContain(modulePath);
    await service.assignTool("org_team_a", "local_agent", {
      toolId: record.id,
    });
    expect(await db.listToolsForProfile("local_agent")).toHaveLength(1);
    await expect(
      service.assignTool("org_team_a", "local_agent", {
        toolId: "detail_private",
      })
    ).rejects.toMatchObject({ status: 404 });
    await db.upsertTool({
      ...record,
      handlerConfig: {},
      handlerType: "builtin",
      id: "detail_local",
      orgId: "org_team_a",
    });
    await expect(
      service.assignTool("org_team_a", "local_agent", {
        toolId: "detail_local",
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assignTool("org_team_b", "local_agent", { toolId: record.id })
    ).rejects.toMatchObject({ status: 404 });

    const instance = await orgService.createSharedAgentInstance(
      "org_team_a",
      agentPublication.id,
      "user_other"
    );

    await expect(
      service.assignTool("org_team_a", instance.id, { toolId: record.id })
    ).rejects.toMatchObject({ status: 403 });
    await orgService.unpublishSharedResource(
      "org_parent",
      publication.id,
      "user_creator"
    );
    await expect(
      service.getTool(record.id, "org_team_a")
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.assignTool("org_team_a", "local_agent", { toolId: record.id })
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await service.listProfileTools("org_team_a", "local_agent")).tools
    ).toEqual([]);
    await service.unassignTool("org_team_a", "local_agent", record.id);
    expect(await db.listToolsForProfile("local_agent")).toEqual([]);
    expect(
      (await service.getTool(record.id, "org_parent")).tool.handlerConfig
    ).toMatchObject({ modulePath });
    expect(
      (await service.getToolSource(record.id, "org_parent")).content
    ).toContain("export async function run");
    await db.upsertTool({ ...record, id: "detail_global", orgId: null });
    await expect(
      service.getTool("detail_global", "org_team_a")
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.assignTool("org_team_a", "local_agent", {
        toolId: "detail_global",
      })
    ).rejects.toMatchObject({ status: 404 });
  });
  test("team tool catalogs show current published sources without parent paths or secrets", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedSharedAgentSelection(db, orgService);
    const service = new ProfileService(db);
    const now = new Date().toISOString();

    const record = {
      createdAt: now,
      description: "Published",
      handlerConfig: {
        env: [{ name: "TOKEN", secret: true, value: "parent-secret" }],
        modulePath: "/private/parent/tool.js",
        requiresApiKey: true,
        token: "parent-secret",
      },
      handlerType: "javascript",
      id: "published_tool",
      name: "Same name",
      orgId: "org_parent",
      updatedAt: now,
    };

    await db.upsertTool(record);
    await db.upsertTool({ ...record, id: "private_tool", name: "Private" });
    await db.upsertTool({
      ...record,
      id: "foreign_tool",
      name: "Foreign",
      orgId: "org_team_b",
    });
    await db.upsertTool({
      ...record,
      description: "Local",
      handlerConfig: {},
      id: "local_tool",
      orgId: "org_team_a",
    });
    await db.upsertTool({
      ...record,
      description: "Global",
      handlerConfig: {},
      id: "global_tool",
      orgId: null,
    });

    const publication = await orgService.publishSharedResource(
      "org_parent",
      { resourceId: record.id, resourceKind: "tool" },
      "user_creator"
    );

    const globalPublication = await orgService.publishSharedResource(
      "org_parent",
      { resourceId: "global_tool", resourceKind: "tool" },
      "user_creator"
    );

    const catalog = await service.listTools("org_team_a");
    const shared = catalog.tools.find((tool) => tool.id === record.id)!;
    expect(shared).toMatchObject({
      handlerConfig: {
        env: [{ name: "TOKEN", secret: true }],
        requiresApiKey: true,
      },
      name: "Same name",
      publicationId: publication.id,
      scope: "parent",
      sourceOrganization: { id: "org_parent", name: "org_parent" },
    });
    expect(JSON.stringify(shared)).not.toContain("/private/parent");
    expect(JSON.stringify(shared)).not.toContain("parent-secret");
    expect(
      catalog.tools.filter((tool) => tool.name === "Same name")
    ).toHaveLength(2);
    expect(catalog.tools.some((tool) => tool.id === "global_tool")).toBe(false);
    expect(
      catalog.tools.some(
        (tool) => tool.id === "private_tool" || tool.id === "foreign_tool"
      )
    ).toBe(false);
    await db.upsertTool({ ...record, name: "Renamed" });
    expect(
      (await service.listTools("org_team_a")).tools.find(
        (tool) => tool.id === record.id
      )?.name
    ).toBe("Renamed");
    await orgService.unpublishSharedResource(
      "org_parent",
      publication.id,
      "user_creator"
    );
    expect(
      (await service.listTools("org_team_a")).tools.some(
        (tool) => tool.id === record.id
      )
    ).toBe(false);
    await orgService.unpublishSharedResource(
      "org_parent",
      globalPublication.id,
      "user_creator"
    );
    expect(
      (await service.listTools("org_team_a")).tools.some(
        (tool) => tool.id === "global_tool"
      )
    ).toBe(false);
    await orgService.publishSharedResource(
      "org_parent",
      { resourceId: record.id, resourceKind: "tool" },
      "user_creator"
    );
    const parent = (await db.getOrganizationById("org_parent"))!;
    const readOrg = db.getOrganizationById.bind(db);
    let parentView = { ...parent, archivedAt: now };

    const lookup = spyOn(db, "getOrganizationById").mockImplementation((id) =>
      id === parent.id ? Promise.resolve(parentView) : readOrg(id)
    );

    try {
      expect(
        (await service.listTools("org_team_a")).tools.some(
          (tool) => tool.id === record.id
        )
      ).toBe(false);
      parentView = { ...parent, archivedAt: "", parentOrgId: "org_team_b" };
      expect(
        (await service.listTools("org_team_a")).tools.some(
          (tool) => tool.id === record.id
        )
      ).toBe(false);
    } finally {
      lookup.mockRestore();
    }

    const team = (await db.getOrganizationById("org_team_a"))!;
    await db.upsertOrganization({ ...team, archivedAt: now });
    expect(
      (await service.listTools("org_team_a")).tools.some(
        (tool) => tool.id === record.id
      )
    ).toBe(false);
    await db.upsertOrganization(team);
    await db.deleteTool(record.id);
    expect(
      (await service.listTools("org_team_a")).tools.some(
        (tool) => tool.id === record.id
      )
    ).toBe(false);
    expect(
      (await service.listTools("org_team_b")).tools.some(
        (tool) => tool.id === "local_tool"
      )
    ).toBe(false);
  });
  test.each([false, true])(
    "shared MCP assignments refresh and check execution for cognito=%s",
    async (cognito) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const now = new Date().toISOString();

      const server = {
        cachedTools: [
          {
            description: "Probe",
            inputSchema: { properties: {}, type: "object" },
            name: "probe",
          },
        ],
        config: { url: "https://example.com/mcp" },
        createdAt: now,
        enabled: true,
        id: "mcp_shared",
        lastError: null,
        name: "Shared",
        orgId: null,
        status: "disconnected" as const,
        transport: "http" as const,
        updatedAt: now,
      };

      await db.upsertMcpServer(server);
      const mcp = new McpService(db, new McpClientManager());
      const call = spyOn(mcp, "callTool").mockResolvedValue({ ok: true });
      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      agent.setMcpService(mcp);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat: () =>
              Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              }),
            name: "test",
          },
        }),
      });

      try {
        const id = await agent.createSession(
          "org_team_a",
          "web",
          profile.id,
          "user_other",
          { cognito, orgRole: "member" }
        );

        const first = (await agent.resolveSession(id, "org_team_a"))!;
        await first.send("First");
        await db.assignMcpServerToProfile("profile_template", server.id);

        const detail = (await agent.getProfile("org_team_a", profile.id))
          .profile;

        expect(detail.mcpServers.map((item) => item.id)).toEqual([server.id]);
        expect(detail.mcpServerCount).toBe(1);
        expect(await db.listMcpServersForProfile(profile.id)).toEqual([]);
        const second = (await agent.resolveSession(id, "org_team_a"))!;
        expect(second).not.toBe(first);
        expect(second.getHistory()).toEqual(first.getHistory());
        await second.send("Second");

        const tool = (
          await agent.resolvePluginExecutionTools("org_team_a", profile.id)
        ).find((item) => item.name === "Shared__probe")!;

        expect(tool).toBeDefined();

        const context = agent.buildPluginToolContext("org_team_a", {
          profileId: profile.id,
          runId: "run",
          workflowId: "workflow",
        });

        expect(await tool.run({}, context)).toEqual({ ok: true });
        expect(call.mock.calls[0]?.slice(3)).toEqual([
          "org_team_a",
          profile.id,
        ]);

        for (const denied of [
          { ...context, orgRole: undefined },
          { ...context, orgId: "org_team_b" },
          { ...context, profileId: "profile_template" },
        ]) {
          await expect(tool.run({}, denied)).rejects.toMatchObject({
            status: denied.orgRole ? 404 : 403,
          });
        }

        expect(call).toHaveBeenCalledTimes(1);
        await db.upsertMcpServer({
          ...server,
          cachedTools: [
            {
              description: "Probe",
              inputSchema: {
                properties: { value: { type: "string" } },
                type: "object",
              },
              name: "probe",
            },
          ],
        });
        const third = (await agent.resolveSession(id, "org_team_a"))!;
        expect(third).not.toBe(second);
        expect(third.getHistory()).toEqual(second.getHistory());
        expect(
          (
            await agent.resolvePluginExecutionTools("org_team_a", profile.id)
          ).find((item) => item.name === tool.name)?.parameters
        ).toMatchObject({ properties: { value: { type: "string" } } });
        await third.send("Third");
        await db.unassignMcpServerFromProfile("profile_template", server.id);
        await expect(tool.run({}, context)).rejects.toMatchObject({
          status: 404,
        });
        expect(call).toHaveBeenCalledTimes(1);
        expect(await db.listMcpServersForProfile(profile.id)).toEqual([]);
        await db.assignMcpServerToProfile("profile_template", server.id);
        await db.upsertMcpServer({ ...server, enabled: false });
        await expect(tool.run({}, context)).rejects.toMatchObject({
          status: 404,
        });
        await db.upsertMcpServer({
          ...server,
          cachedTools: [
            { description: "Probe", name: "probe" },
            { description: "Probe", name: "probe" },
          ],
        });
        await expect(tool.run({}, context)).rejects.toMatchObject({
          status: 409,
        });
        await expect(
          agent.resolvePluginExecutionTools("org_team_a", profile.id)
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          orgService.publishSharedResource(
            "org_parent",
            { resourceId: "profile_template", resourceKind: "agent" },
            "user_creator"
          )
        ).rejects.toMatchObject({ status: 409 });
        await db.upsertMcpServer(server);

        const scoped = spyOn(
          db,
          "listMcpServersForProfile"
        ).mockResolvedValueOnce([{ ...server, orgId: "org_parent" }]);

        try {
          await expect(tool.run({}, context)).rejects.toMatchObject({
            status: 409,
          });
        } finally {
          scoped.mockRestore();
        }

        await orgService.unpublishSharedResource(
          "org_parent",
          publication.id,
          "user_creator"
        );
        await expect(tool.run({}, context)).rejects.toMatchObject({
          status: 404,
        });
        expect(call).toHaveBeenCalledTimes(1);
        expect(
          (await agent.getSessionMessages(id, "org_team_a"))!.messages.filter(
            (item) => item.role === "user"
          )
        ).toHaveLength(3);

        if (cognito) {
          expect(await db.getSession(id)).toBeNull();
        }
      } finally {
        call.mockRestore();
      }
    }
  );
  test.each([
    { cognito: false, handlerType: "javascript" },
    { cognito: true, handlerType: "javascript" },
    { cognito: false, handlerType: "python" },
    { cognito: true, handlerType: "python" },
    { cognito: false, handlerType: "javascript", local: true },
    { cognito: true, handlerType: "javascript", local: true },
    { cognito: false, handlerType: "python", local: true },
    { cognito: true, handlerType: "python", local: true },
  ])(
    "shared stored tools use current definitions and team credentials for %j",
    async ({ cognito, handlerType, local = false }) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      let profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      if (local) {
        profile = { ...profile, id: "local_tool_agent", name: "Local tools" };
        await db.upsertProfile(profile);
        await mkdir(getProfileSoulDir("org_team_a", profile.id), {
          recursive: true,
        });
      }

      const assignmentProfileId = local ? profile.id : "profile_template";
      const now = new Date().toISOString();
      await mkdir(getCustomToolsDir("org_parent"), { recursive: true });
      const filename = handlerType === "javascript" ? "shared.js" : "shared.py";
      const modulePath = join(getCustomToolsDir("org_parent"), filename);

      const source =
        handlerType === "javascript"
          ? `import {writeFile} from "node:fs/promises";
export async function run(input, context) {
  await writeFile("tool.marker", "team");
  return {keyIsTeam: process.env.NAKAMA_TOOL_API_KEY === "team-key", config: process.env.NAKAMA_CONFIG_DIR ?? null, cwd: process.cwd(), workspace: context.workspaceRoot, version: "first"};
}`
          : `import json
import os
import sys

def run(input, context):
    with open("tool.marker", "w") as handle:
        handle.write("team")
    return {"keyIsTeam": os.environ.get("NAKAMA_TOOL_API_KEY") == "team-key", "config": os.environ.get("NAKAMA_CONFIG_DIR"), "cwd": os.getcwd(), "workspace": os.environ.get("NAKAMA_WORKSPACE_ROOT"), "version": "first"}

if __name__ == "__main__":
    print(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))
`;

      await writeFile(modulePath, source);

      const record = {
        createdAt: now,
        description: "Shared probe",
        handlerConfig: {
          modulePath: filename,
          parameters: { properties: {}, type: "object" },
          requiresApiKey: true,
        },
        handlerType,
        id: "tool_parent",
        name: "shared_probe",
        orgId: "org_parent",
        updatedAt: now,
      };

      await db.upsertTool(record);
      await db.upsertTool({
        createdAt: now,
        description: "Read",
        handlerConfig: {},
        handlerType: "builtin",
        id: "global_read",
        name: "read_file",
        orgId: null,
        updatedAt: now,
      });

      const toolPublication = await orgService.publishSharedResource(
        "org_parent",
        { resourceId: record.id, resourceKind: "tool" },
        "user_creator"
      );

      await saveToolApiKey("org_parent", record.id, "parent-key");
      const turns: GenerateChatInput[] = [];
      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat(input: GenerateChatInput) {
              turns.push(input);

              return Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              });
            },
            name: "test",
          },
        }),
      });

      const id = await agent.createSession(
        "org_team_a",
        "web",
        profile.id,
        "user_other",
        { cognito, orgRole: "member" }
      );

      const first = (await agent.resolveSession(id, "org_team_a"))!;
      await first.send("First");
      await db.assignToolToProfile(assignmentProfileId, record.id);
      await db.assignToolToProfile(assignmentProfileId, "global_read");
      const second = (await agent.resolveSession(id, "org_team_a"))!;

      if (!local) {
        const detail = (await agent.getProfile("org_team_a", profile.id))
          .profile;

        expect(detail.tools.map((tool) => tool.id).sort()).toEqual(
          ["global_read", record.id].sort()
        );
        expect(detail.toolCount).toBe(2);
        expect(detail.sharedAgent?.available).toBe(true);
        const assigned = await agent.listProfileTools("org_team_a", profile.id);
        expect(assigned.tools.map((tool) => tool.id).sort()).toEqual(
          ["global_read", record.id].sort()
        );
        expect(
          assigned.tools.find((tool) => tool.id === record.id)
        ).toMatchObject({
          handlerConfig: { requiresApiKey: true },
          publicationId: toolPublication.id,
          scope: "parent",
        });
        expect(JSON.stringify(assigned)).not.toContain(
          record.handlerConfig.modulePath
        );
        expect(JSON.stringify(detail)).not.toContain(
          record.handlerConfig.modulePath
        );
        expect(
          (await agent.listProfiles("org_team_a")).profiles.find(
            (item) => item.id === profile.id
          )?.toolCount
        ).toBe(2);
        expect(await db.listToolsForProfile(profile.id)).toEqual([]);
      }

      expect(second).not.toBe(first);
      expect(second.getHistory()).toEqual(first.getHistory());
      await second.send("Second");
      expect(turns[1]!.tools?.map((tool) => tool.name)).toContain(
        "shared_probe"
      );

      const tools = await agent.resolvePluginExecutionTools(
        "org_team_a",
        profile.id
      );

      const tool = tools.find((item) => item.name === "shared_probe")!;
      const read = tools.find((item) => item.name === "read_file")!;

      const context = agent.buildPluginToolContext("org_team_a", {
        profileId: profile.id,
        runId: "run",
        workflowId: "workflow",
      });

      const teamDir = getProfileSoulDir("org_team_a", profile.id);
      const parentDir = getProfileSoulDir("org_parent", "profile_template");
      await mkdir(parentDir, { recursive: true });
      await writeFile(join(teamDir, "note.txt"), "Team note");
      await writeFile(join(parentDir, "note.txt"), "Private parent note");
      expect(await tool.run({}, context)).toMatchObject({
        orgId: "org_team_a",
        toolId: record.id,
        type: "tool_credentials_required",
      });
      await expect(readFile(join(teamDir, "tool.marker"))).rejects.toThrow();
      await saveToolApiKey("org_team_a", record.id, "team-key");

      const result = await tool.run(
        {},
        { ...context, workspaceRoot: parentDir }
      );

      expect(result).toMatchObject({
        config: null,
        keyIsTeam: true,
        version: "first",
        workspace: teamDir,
      });
      // SAFETY: Both tool fixtures return their working directory as a string.
      expect(await realpath((result as { cwd: string }).cwd)).toBe(
        await realpath(teamDir)
      );
      expect(await readFile(join(teamDir, "tool.marker"), "utf8")).toBe("team");
      await expect(readFile(join(parentDir, "tool.marker"))).rejects.toThrow();
      expect(
        await read.run(
          { path: "note.txt" },
          local ? context : { ...context, workspaceRoot: parentDir }
        )
      ).toHaveProperty("content", "Team note");

      for (const denied of [
        { ...context, orgRole: undefined },
        { ...context, orgId: "org_team_b" },
        { ...context, profileId: "profile_template" },
      ]) {
        await expect(tool.run({}, denied)).rejects.toMatchObject({
          status: denied.orgRole ? 404 : 403,
        });
      }

      await writeFile(modulePath, source.replace('"first"', '"updated"'));
      await db.upsertTool({ ...record, name: "ask_user_question" });
      await expect(
        agent.resolvePluginExecutionTools("org_team_a", profile.id)
      ).rejects.toMatchObject({ status: 409 });
      await db.upsertTool({
        ...record,
        handlerConfig: {
          ...record.handlerConfig,
          parameters: {
            properties: { updated: { type: "string" } },
            type: "object",
          },
        },
      });
      const third = (await agent.resolveSession(id, "org_team_a"))!;
      expect(third).not.toBe(second);
      expect(third.getHistory()).toEqual(second.getHistory());

      const current = (
        await agent.resolvePluginExecutionTools("org_team_a", profile.id)
      ).find((item) => item.name === "shared_probe")!;

      expect(current.parameters).toMatchObject({
        properties: { updated: { type: "string" } },
      });
      expect(await tool.run({}, context)).toMatchObject({
        keyIsTeam: true,
        version: "updated",
      });
      await third.send("Third");
      await db.upsertTool({
        ...record,
        handlerType: handlerType === "python" ? "javascript" : "python",
      });
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 404,
      });
      await db.unassignToolFromProfile(assignmentProfileId, record.id);
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 404,
      });
      expect(
        (await db.listToolsForProfile(profile.id)).map((item) => item.id)
      ).toEqual(local ? ["global_read"] : []);
      expect(await loadToolApiKey("org_parent", record.id)).toBe("parent-key");
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );

      if (local) {
        expect(await read.run({ path: "note.txt" }, context)).toHaveProperty(
          "content",
          "Team note"
        );
        await db.assignToolToProfile(assignmentProfileId, record.id);
        await orgService.unpublishSharedResource(
          "org_parent",
          toolPublication.id,
          "user_creator"
        );
        await expect(tool.run({}, context)).rejects.toMatchObject({
          status: 404,
        });
        await expect(
          agent.resolveSession(id, "org_team_a")
        ).rejects.toMatchObject({ status: 404 });
      } else {
        expect(
          (await agent.listProfileTools("org_team_a", profile.id)).tools
        ).toEqual([]);
        await expect(
          read.run({ path: "note.txt" }, context)
        ).rejects.toMatchObject({ status: 404 });
      }

      expect(
        (await agent.getSessionMessages(id, "org_team_a"))!.messages.filter(
          (message) => message.role === "user"
        )
      ).toHaveLength(3);

      if (cognito) {
        expect(await db.getSession(id)).toBeNull();
      }
    }
  );

  test("shared instances inherit team approval policy and retain local overrides", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);
    const source = (await db.getProfile("profile_template"))!;
    await db.upsertProfile({
      ...source,
      automationsEnabled: false,
      skillsCuratorConsolidateEnabled: true,
      skillsPostTurnReview: false,
      skillsWriteApproval: false,
    });

    for (const teamId of ["org_team_a", "org_team_b"]) {
      await db.upsertOrganization({
        ...(await db.getOrganizationById(teamId))!,
        skillsWriteApproval: teamId === "org_team_a",
      });
    }

    const first = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );

    const sibling = await orgService.createSharedAgentInstance(
      "org_team_b",
      publication.id,
      "user_other"
    );

    for (const profile of [first, sibling]) {
      expect(profile).toMatchObject({
        automationsEnabled: true,
        skillsCuratorConsolidateEnabled: null,
        skillsPostTurnReview: null,
        skillsWriteApproval: null,
      });
    }

    expect(await isSkillWriteApprovalRequired(db, "org_team_a", first.id)).toBe(
      true
    );
    expect(
      await isSkillWriteApprovalRequired(db, "org_team_b", sibling.id)
    ).toBe(false);
    await db.upsertProfile({ ...source, skillsWriteApproval: true });
    expect(await isSkillWriteApprovalRequired(db, "org_team_a", first.id)).toBe(
      true
    );
    expect(
      await isSkillWriteApprovalRequired(db, "org_team_b", sibling.id)
    ).toBe(false);
    await db.upsertProfile({ ...first, skillsWriteApproval: false });
    expect(await isSkillWriteApprovalRequired(db, "org_team_a", first.id)).toBe(
      false
    );

    const resolved = await orgService.resolveSharedAgentProfile(
      "org_team_a",
      first.id
    );

    expect(resolved?.skillsWriteApproval).toBe(false);

    const retry = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );

    expect(retry.id).toBe(first.id);
    expect(retry.skillsWriteApproval).toBe(false);
    await expect(
      isSkillWriteApprovalRequired(db, "org_team_b", first.id)
    ).rejects.toMatchObject({ status: 404 });
  });
  test("shared profile resolution uses only permitted current source settings", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);

    const profile = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );

    const previousConfig = await loadUserConfig();

    try {
      await saveUserConfig({
        defaultProviderId: "shared-provider",
        providers: [
          {
            apiKey: "",
            baseUrl: "http://localhost:11434/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "shared-model", name: "Model" },
            ],
            id: "shared-provider",
            label: "Provider",
            type: "ollama",
          },
        ],
        thinkingEffort: "medium",
        thinkingEnabled: true,
      });
      const source = (await db.getProfile("profile_template"))!;
      await db.upsertProfile({
        ...source,
        automationsEnabled: false,
        model: "shared-provider::shared-model",
        name: "Updated template",
        skillsPostTurnReview: false,
        skillsWriteApproval: false,
        systemPrompt: "Updated instructions",
        thinkingEffort: "high",
        thinkingEnabled: true,
      });

      const resolved = (await orgService.resolveSharedAgentProfile(
        "org_team_a",
        profile.id
      ))!;

      expect(resolved).toMatchObject({
        acpAgent: null,
        acpSettings: null,
        createdAt: profile.createdAt,
        id: profile.id,
        isDefault: false,
        isSuper: false,
        model: "shared-provider::shared-model",
        name: "Updated template",
        orgId: "org_team_a",
        thinkingEffort: "high",
        thinkingEnabled: true,
        updatedAt: profile.updatedAt,
      });
      expect(resolved.systemPrompt).toBe(
        (await db.getProfile(source.id))!.systemPrompt
      );
      expect(resolved.automationsEnabled).toBe(profile.automationsEnabled);
      expect(resolved.skillsPostTurnReview).toBe(profile.skillsPostTurnReview);
      expect(resolved.skillsWriteApproval).toBe(profile.skillsWriteApproval);
      const profiles = new ProfileService(db);
      profiles.setOrgService(orgService);

      const detail = (await profiles.getProfile("org_team_a", profile.id))
        .profile;

      expect(detail).toMatchObject({
        id: profile.id,
        model: "shared-provider::shared-model",
        name: "Updated template",
        sharedAgent: {
          available: true,
          publicationId: publication.id,
          sourceOrgId: "org_parent",
          sourceProfileId: source.id,
        },
        systemPrompt: resolved.systemPrompt,
      });
      expect(
        (await profiles.listProfiles("org_team_a")).profiles.find(
          (item) => item.id === profile.id
        )
      ).toMatchObject({
        model: detail.model,
        name: detail.name,
        sharedAgent: detail.sharedAgent,
      });
      await expect(
        profiles.getProfile("org_team_b", profile.id)
      ).rejects.toMatchObject({ status: 404 });
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );
      expect(
        (await profiles.getProfile("org_team_a", profile.id)).profile
          .sharedAgent?.available
      ).toBe(false);
      expect(
        (await profiles.listProfiles("org_team_a")).profiles.find(
          (item) => item.id === profile.id
        )?.sharedAgent?.available
      ).toBe(false);
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );
      expect(
        await orgService.resolveSharedAgentProfile("org_team_b", profile.id)
      ).toBeNull();
      expect(
        await orgService.resolveSharedAgentProfile("org_parent", source.id)
      ).toBeNull();
    } finally {
      if (previousConfig) {
        await saveUserConfig(previousConfig);
      } else {
        await rm(getUserConfigPath(), { force: true });
      }
    }
  });

  test.each([false, true])(
    "shared model checks preserve global access and history for cognito=%s",
    async (cognito) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const previousConfig = await loadUserConfig();

      const config: UserConfig = {
        defaultProviderId: "first",
        providers: ["first", "second"].map((id) => ({
          apiKey: `${id}-key`,
          baseUrl: `https://${id}.example.com/v1`,
          createdAt: new Date().toISOString(),
          customModels: [{ default: true, id: "same-model", name: "Model" }],
          id,
          label: id,
          type: "openai_compatible" as const,
        })),
        thinkingEffort: "medium",
        thinkingEnabled: true,
      };

      try {
        await saveUserConfig(config);
        const source = (await db.getProfile("profile_template"))!;
        await db.upsertProfile({ ...source, model: "second::same-model" });
        const codingContext = { orgId: "org_team_a", profileId: profile.id };
        await db.upsertWorkspaceSettings(
          mergeWorkspaceSettings(null, {
            codingAgentHarnesses: [
              {
                args: [],
                command: "echo",
                enabled: true,
                id: "coding-harness-codex",
                kind: "codex",
                name: "Codex",
              },
            ],
            codingAgentProviderPassthrough: true,
            id: "workspace-settings",
            imageModel: null,
            selectedCodingAgentHarness: null,
            transcriptionModel: null,
            updatedAt: new Date().toISOString(),
            visionModel: null,
          })
        );
        const codingInput = { command: "echo task" };

        const initialCoding = await enrichCodingAgentBashInput(
          db,
          codingInput,
          codingContext,
          config,
          orgService
        );

        expect(initialCoding.env?.OPENAI_API_KEY).toBe("second-key");
        expect(initialCoding.env?.OPENAI_MODEL).toBe("same-model");
        await expect(
          enrichCodingAgentBashInput(
            db,
            codingInput,
            { ...codingContext, orgId: "org_team_b" },
            config,
            orgService
          )
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          enrichCodingAgentBashInput(db, codingInput, codingContext, config)
        ).rejects.toMatchObject({ status: 503 });

        const modelPublication = await orgService.publishSharedResource(
          "org_parent",
          { resourceId: "second::same-model", resourceKind: "model" },
          "user_creator"
        );

        const selections: Array<string | null> = [];
        const agent = new AgentService(config, null, db);
        agent.setOrgService(orgService);
        Object.assign(agent, {
          _providerConfigured: true,
          createHarnessForProfile: (
            settings: StoredProfileRecord,
            model: string | null
          ) => {
            expect(settings.orgId).toBe("org_team_a");
            selections.push(model);

            return {
              provider: {
                generateChat: () =>
                  Promise.resolve({
                    assistantMessage: { content: "Done", role: "assistant" },
                    content: "Done",
                    toolCalls: [],
                  }),
                name: "test",
              },
            };
          },
          resolveProfileTools: async () => [],
        });

        const id = await agent.createSession(
          "org_team_a",
          "web",
          profile.id,
          "user_other",
          { cognito, orgRole: "member" }
        );

        const first = (await agent.resolveSession(id, "org_team_a"))!;
        await first.send("Keep history");
        const history = [...first.getHistory()];
        expect(selections).toEqual(["second::same-model"]);
        await orgService.unpublishSharedResource(
          "org_parent",
          modelPublication.id,
          "user_creator"
        );
        expect(await agent.beginSessionTurn(id, "org_team_a")).toBe(true);
        sessionTurnRegistry.cancelTurn(id);
        expect(await agent.resolveSession(id, "org_team_a")).toBe(first);
        Object.assign(agent, {
          userConfig: { ...config, providers: [config.providers[0]!] },
        });
        await expect(
          agent.beginSessionTurn(id, "org_team_a")
        ).rejects.toMatchObject({ status: 400 });
        expect(sessionTurnRegistry.isActive(id)).toBe(false);
        expect(selections).toHaveLength(1);
        expect(first.getHistory()).toEqual(history);
        Object.assign(agent, {
          userConfig: {
            ...config,
            providers: config.providers.map((provider) => ({
              ...provider,
              customModels: [
                { default: true, id: "different-model", name: "Different" },
              ],
            })),
          },
        });
        await expect(
          agent.beginSessionTurn(id, "org_team_a")
        ).rejects.toMatchObject({ status: 400 });
        expect(selections).toHaveLength(1);
        Object.assign(agent, { userConfig: config });
        await db.upsertProfile({ ...source, model: "first::same-model" });

        const changedCoding = await enrichCodingAgentBashInput(
          db,
          codingInput,
          codingContext,
          config,
          orgService
        );

        expect(changedCoding.env?.OPENAI_API_KEY).toBe("first-key");
        expect((await db.getProfile(profile.id))!.model).toBe(profile.model);
        expect(await agent.beginSessionTurn(id, "org_team_a")).toBe(true);
        sessionTurnRegistry.cancelTurn(id);
        const second = (await agent.resolveSession(id, "org_team_a"))!;
        expect(second).not.toBe(first);
        expect(second.getHistory()).toEqual(history);
        expect(selections).toEqual(["second::same-model", "first::same-model"]);
        expect(
          await agent.updateSessionModel(id, "org_team_a", "second::same-model")
        ).toBe(true);
        const overridden = (await agent.resolveSession(id, "org_team_a"))!;
        expect(overridden.getHistory()).toEqual(history);
        expect(selections.at(-1)).toBe("second::same-model");
        const builds = selections.length;
        Object.assign(agent, {
          userConfig: { ...config, providers: [config.providers[0]!] },
        });
        await expect(
          agent.beginSessionTurn(id, "org_team_a")
        ).rejects.toMatchObject({ status: 400 });
        expect(sessionTurnRegistry.isActive(id)).toBe(false);
        expect(selections).toHaveLength(builds);
        expect(
          (await agent.getSessionMessages(id, "org_team_a"))!.messages
        ).toEqual(history);
        Object.assign(agent, { userConfig: config });
        expect(await agent.beginSessionTurn(id, "org_team_a")).toBe(true);
        sessionTurnRegistry.cancelTurn(id);
        expect(await agent.resolveSession(id, "org_team_a")).toBe(overridden);
        await orgService.unpublishSharedResource(
          "org_parent",
          publication.id,
          "user_creator"
        );
        await expect(
          enrichCodingAgentBashInput(
            db,
            codingInput,
            codingContext,
            config,
            orgService
          )
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        if (previousConfig) {
          await saveUserConfig(previousConfig);
        } else {
          await rm(getUserConfigPath(), { force: true });
        }
      }
    }
  );

  test.each([false, true])(
    "shared configuration refresh preserves team history for cognito=%s",
    async (cognito) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const teamDir = getProfileSoulDir("org_team_a", profile.id);
      await writeFile(join(teamDir, "MEMORY.md"), "Team memory");
      await writeFile(join(teamDir, "USER.md"), "Team context");
      const sourceDir = getProfileSoulDir("org_parent", "profile_template");
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, "SOUL.md"), "Published identity");
      await writeFile(join(sourceDir, "STYLE.md"), "Published style");
      await writeFile(
        join(sourceDir, "INSTRUCTIONS.md"),
        "Published operations"
      );
      await mkdir(join(sourceDir, "MEMORY.md"));
      await writeFile(join(sourceDir, "USER.md"), "Private parent context");
      await writeFile(join(sourceDir, "private.txt"), "Private parent file");
      await symlink(
        join(sourceDir, "missing-examples"),
        join(sourceDir, "examples")
      );
      await writeFile(join(teamDir, "SOUL.md"), "Stale team identity");
      await writeFile(join(teamDir, "STYLE.md"), "Stale team style");
      await db.setUserContext(
        "org_team_a",
        "user_other",
        "Team user context",
        new Date().toISOString()
      );
      const builds: StoredProfileRecord[] = [];
      const turns: GenerateChatInput[] = [];
      let failBuild = false;
      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: (settings: StoredProfileRecord) => {
          builds.push(settings);

          return {
            provider: {
              generateChat: (input: GenerateChatInput) => {
                turns.push(input);

                return Promise.resolve({
                  assistantMessage: { content: "Done", role: "assistant" },
                  content: "Done",
                  toolCalls: [],
                });
              },
              name: "test",
            },
          };
        },
        resolveProfileTools: async () => {
          if (failBuild) {
            throw new Error("Build failed");
          }

          return [];
        },
      });

      const id = await agent.createSession(
        "org_team_a",
        "web",
        profile.id,
        "user_other",
        { cognito, orgRole: "member" }
      );

      const first = (await agent.resolveSession(id, "org_team_a"))!;
      await first.send("First");
      expect(turns[0]!.system).toContain("Published identity");
      expect(turns[0]!.system).toContain("Published style");
      expect(turns[0]!.system).toContain("Published operations");
      expect(turns[0]!.system).toContain("Team memory");
      expect(turns[0]!.system).toContain("Team user context");

      for (const privateText of [
        "Private parent context",
        "Private parent file",
        "Stale team identity",
        "Stale team style",
      ]) {
        expect(turns[0]!.system).not.toContain(privateText);
      }

      const history = [...first.getHistory()];
      expect(await agent.beginSessionTurn(id, "org_team_a")).toBe(true);
      const source = (await db.getProfile("profile_template"))!;
      await db.upsertProfile({
        ...source,
        name: "Changed template",
        systemPrompt: "Changed instructions",
        thinkingEffort: "high",
        thinkingEnabled: true,
      });
      expect(await agent.resolveSession(id, "org_team_a")).toBe(first);
      sessionTurnRegistry.cancelTurn(id);
      failBuild = true;
      await expect(agent.beginSessionTurn(id, "org_team_a")).rejects.toThrow();
      expect(sessionTurnRegistry.isActive(id)).toBe(false);
      expect(first.getHistory()).toEqual(history);
      expect(
        (await agent.getSessionMessages(id, "org_team_a"))!.messages
      ).toEqual(history);
      failBuild = false;
      expect(await agent.beginSessionTurn(id, "org_team_a")).toBe(true);
      const second = (await agent.resolveSession(id, "org_team_a"))!;
      expect(second).not.toBe(first);
      expect(second.getHistory()).toEqual(history);
      expect(builds.at(-1)).toMatchObject({
        id: profile.id,
        name: "Changed template",
        orgId: "org_team_a",
        thinkingEffort: "high",
        thinkingEnabled: true,
      });
      expect(builds.at(-1)!.systemPrompt).toBe(
        (await db.getProfile(source.id))!.systemPrompt
      );
      sessionTurnRegistry.cancelTurn(id);
      await second.send("Second");
      expect(await agent.resolveSession(id, "org_team_a")).toBe(second);
      expect(
        (await agent.getSessionMessages(id, "org_team_a"))!.messages.filter(
          (message) => message.role === "user"
        )
      ).toHaveLength(2);
      await writeFile(
        join(sourceDir, "USER.md"),
        "Changed private parent context"
      );
      expect(await agent.resolveSession(id, "org_team_a")).toBe(second);
      await writeFile(join(sourceDir, "STYLE.md"), "Changed published style");
      const third = (await agent.resolveSession(id, "org_team_a"))!;
      expect(third).not.toBe(second);
      expect(third.getHistory()).toEqual(second.getHistory());
      await third.send("Third");
      expect(turns[2]!.system).toContain("Changed published style");
      expect(turns[2]!.system).toContain("Team memory");
      expect(turns[2]!.system).toContain("Team user context");
      await rm(join(sourceDir, "SOUL.md"));
      await rm(join(sourceDir, "STYLE.md"));
      await rm(join(sourceDir, "INSTRUCTIONS.md"));
      const fourth = (await agent.resolveSession(id, "org_team_a"))!;
      expect(fourth).not.toBe(third);
      expect(fourth.getHistory()).toEqual(third.getHistory());
      await fourth.send("Fourth");

      for (const removedText of [
        "Published identity",
        "Changed published style",
        "Published operations",
        "Stale team identity",
        "Stale team style",
      ]) {
        expect(turns[3]!.system).not.toContain(removedText);
      }

      expect(turns[3]!.system).toContain("Team memory");
      expect(turns[3]!.system).toContain("Team user context");
      expect(
        (await agent.getSessionMessages(id, "org_team_a"))!.messages.filter(
          (message) => message.role === "user"
        )
      ).toHaveLength(4);
      expect(await readFile(join(teamDir, "SOUL.md"), "utf8")).toBe(
        "Stale team identity"
      );
      expect(await readFile(join(teamDir, "STYLE.md"), "utf8")).toBe(
        "Stale team style"
      );
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );
      expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
        "Team memory"
      );
      expect(await readFile(join(teamDir, "USER.md"), "utf8")).toBe(
        "Team context"
      );

      if (cognito) {
        expect(await db.getSession(id)).toBeNull();
        expect(await db.listMessagesForSession(id)).toEqual([]);
      }
    }
  );

  test.each(["SOUL.md", "STYLE.md", "INSTRUCTIONS.md"])(
    "published %s rejects aliases to private files and non-file sources",
    async (filename) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const sourceDir = getProfileSoulDir("org_parent", "profile_template");
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, "MEMORY.md"), "Private parent memory");
      const filePath = join(sourceDir, filename);
      await symlink(join(sourceDir, "MEMORY.md"), filePath);
      await expect(
        orgService.publishSharedResource(
          "org_parent",
          { resourceId: "profile_template", resourceKind: "agent" },
          "user_creator"
        )
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        orgService.resolveSharedAgentProfile("org_team_a", profile.id)
      ).rejects.toMatchObject({ status: 404 });
      await rm(filePath);
      await mkdir(filePath);
      await expect(
        orgService.resolveSharedAgentProfile("org_team_a", profile.id)
      ).rejects.toMatchObject({ status: 404 });
      await rm(filePath, { recursive: true });
      await writeFile(filePath, "Published configuration");

      const resolved = (await orgService.resolveSharedAgentProfile(
        "org_team_a",
        profile.id
      ))!;

      expect(Object.keys(resolved.publishedSoul).sort()).toEqual([
        "instructions",
        "soul",
        "style",
      ]);
      expect(Object.values(resolved.publishedSoul).filter(Boolean)).toEqual([
        "Published configuration",
      ]);
      expect(await readFile(join(sourceDir, "MEMORY.md"), "utf8")).toBe(
        "Private parent memory"
      );
    }
  );

  test.each([false, true])(
    "new turns reject unavailable shared agents and preserve history for cognito=%s",
    async (cognito) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      const agent = new AgentService(null, null, db);
      agent.setOrgService(orgService);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat: () =>
              Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              }),
            name: "test",
          },
        }),
        resolveProfileTools: async () => [],
      });

      const id = await agent.createSession(
        "org_team_a",
        "web",
        profile.id,
        "user_other",
        { cognito, orgRole: "member" }
      );

      const session = (await agent.resolveSession(id, "org_team_a"))!;
      await session.send("Keep this history");
      const history = [...session.getHistory()];
      const source = (await db.getProfile("profile_template"))!;
      await db.upsertProfile({ ...source, isSuper: true });
      await expect(
        agent.beginSessionTurn(id, "org_team_a")
      ).rejects.toMatchObject({ status: 404 });
      expect(sessionTurnRegistry.isActive(id)).toBe(false);
      await db.upsertProfile(source);
      expect(await agent.beginSessionTurn(id, "org_team_a")).toBe(true);
      sessionTurnRegistry.cancelTurn(id);
      await orgService.unpublishSharedResource(
        "org_parent",
        publication.id,
        "user_creator"
      );
      await expect(
        agent.beginSessionTurn(id, "org_team_a")
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        agent.resolveSession(id, "org_team_a")
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        agent.createSession("org_team_a", "web", profile.id, "user_other")
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        agent.runAutomationPrompt("org_team_a", profile.id, "Task")
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        agent.resolvePluginExecutionTools("org_team_a", profile.id)
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        agent.runPluginSummarize("org_team_a", profile.id, "Task", {})
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        agent.runSubAgentPrompt({
          agentDepth: 1,
          orgId: "org_team_a",
          profileId: profile.id,
          task: "Task",
          userId: "user_other",
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(sessionTurnRegistry.isActive(id)).toBe(false);
      expect(session.getHistory()).toEqual(history);
      expect(
        (await agent.getSessionMessages(id, "org_team_a"))?.profileId
      ).toBe(profile.id);
      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );

      if (cognito) {
        expect(await db.getSession(id)).toBeNull();
      }
    }
  );

  test.each(["parent-archive", "team-archive", "team-pending", "reparent"])(
    "shared runtime rejects %s without removing the instance",
    async (change) => {
      const { orgService, databaseAdapter: db } = createOrgService();
      const publication = await seedSharedAgentSelection(db, orgService);

      const profile = await orgService.createSharedAgentInstance(
        "org_team_a",
        publication.id,
        "user_other"
      );

      await orgService.resolveSharedAgentProfile("org_team_a", profile.id);

      const org = (await db.getOrganizationById(
        change === "parent-archive" ? "org_parent" : "org_team_a"
      ))!;

      const unavailable = {
        ...org,
        archivedAt: change.endsWith("archive")
          ? new Date().toISOString()
          : null,
        parentOrgId: change === "reparent" ? null : org.parentOrgId,
        setupPending: change === "team-pending",
      };

      const getOrganization = db.getOrganizationById.bind(db);

      const read = spyOn(db, "getOrganizationById").mockImplementation((id) =>
        id === org.id ? Promise.resolve(unavailable) : getOrganization(id)
      );

      try {
        await expect(
          orgService.resolveSharedAgentProfile("org_team_a", profile.id)
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        read.mockRestore();
      }

      expect(await db.getProfileForOrg(profile.id, "org_team_a")).toEqual(
        profile
      );
    }
  );

  test("shared runtime fails closed without the organization service", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    const publication = await seedSharedAgentSelection(db, orgService);

    const profile = await orgService.createSharedAgentInstance(
      "org_team_a",
      publication.id,
      "user_other"
    );

    const agent = new AgentService(null, null, db);
    await expect(
      agent.createSession("org_team_a", "web", profile.id, "user_other")
    ).rejects.toMatchObject({ status: 503 });
    expect(await db.listSessions()).toHaveLength(0);
  });

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
  test("published tool readiness requires the active team's credentials", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedSharedAgentSelection(db, orgService);
    const now = new Date().toISOString();

    for (const handlerType of ["javascript", "python"] as const) {
      const id = `credential_tool_${handlerType}`;
      await db.upsertTool({
        createdAt: now,
        description: "Credential probe",
        handlerConfig: {
          env: [{ name: "SERVICE_TOKEN", secret: true }],
          modulePath: handlerType === "javascript" ? "probe.js" : "probe.py",
          requiresApiKey: true,
        },
        handlerType,
        id,
        name: id,
        orgId: "org_parent",
        updatedAt: now,
      });

      const publication = await orgService.publishSharedResource(
        "org_parent",
        { resourceId: id, resourceKind: "tool" },
        "user_creator"
      );

      await saveToolApiKey("org_parent", id, "private-parent-key");
      await saveToolEnv(
        "org_parent",
        id,
        [{ name: "SERVICE_TOKEN", secret: true }],
        {
          SERVICE_TOKEN: "private-parent-token",
        }
      );

      const parent = await orgService.listSharedResources(
        "org_parent",
        "user_creator"
      );

      expect(
        parent.resources.find((item) => item.id === publication.id)?.readiness
      ).toBe("ready");

      const first = await orgService.listSharedResources(
        "org_team_a",
        "user_other"
      );

      expect(
        first.resources.find((item) => item.id === publication.id)?.readiness
      ).toBe("requires_setup");
      expect(JSON.stringify(first)).not.toContain("private-parent");
      await saveToolApiKey("org_team_a", id, "private-team-key");
      expect(
        (
          await orgService.listSharedResources("org_team_a", "user_other")
        ).resources.find((item) => item.id === publication.id)?.readiness
      ).toBe("requires_setup");
      await saveToolEnv(
        "org_team_a",
        id,
        [{ name: "SERVICE_TOKEN", secret: true }],
        {
          SERVICE_TOKEN: "private-team-token",
        }
      );

      const ready = await orgService.getOrganizationOverview(
        "org_team_a",
        "user_other"
      );

      expect(
        ready.sharedResources.find((item) => item.id === publication.id)
          ?.readiness
      ).toBe("ready");
      expect(JSON.stringify(ready)).not.toContain("private-team");
      expect(
        (
          await orgService.listSharedResources("org_team_b", "user_other")
        ).resources.find((item) => item.id === publication.id)?.readiness
      ).toBe("requires_setup");
      await deleteOrgToolCredentials("org_team_a");
      expect(
        (
          await orgService.listSharedResources("org_team_a", "user_other")
        ).resources.find((item) => item.id === publication.id)?.readiness
      ).toBe("requires_setup");
      const tool = (await db.getTool(id))!;

      for (const handlerConfig of [
        null,
        [],
        { modulePath: "probe.js", requiresApiKey: "true" },
      ]) {
        await db.upsertTool({ ...tool, handlerConfig });
        expect(
          (
            await orgService.listSharedResources("org_team_a", "user_other")
          ).resources.find((item) => item.id === publication.id)?.readiness
        ).toBe("unavailable");
      }

      await db.upsertTool(tool);
      await db.deleteTool(id);
      expect(
        (
          await orgService.listSharedResources("org_team_a", "user_other")
        ).resources.some((item) => item.id === publication.id)
      ).toBe(false);
    }
  });
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
      orgService.publishSharedResource(
        "org_parent",
        request,
        "user_secondary_member"
      )
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
        "user_secondary_member"
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
        "user_secondary_member"
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

    const sourceAlias = join(getUserConfigDir(), `${profileId}-source-alias`);
    await symlink(sourcePath, sourceAlias);
    await db.upsertSkill({ ...skill, sourcePath: sourceAlias });
    expect(
      await orgService.publishSharedResource(
        "org_parent",
        request,
        "user_creator"
      )
    ).toEqual(publication);
    await db.upsertSkill(skill);
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

  for (const action of ["delete", "replace"] as const) {
    test(`document ${action} removes only its own publication`, async () => {
      const { orgService, databaseAdapter: db } = createOrgService();
      await seedTeamParent(db);
      const profiles = new ProfileService(db);
      const attachment = source();

      const uploaded = await profiles.uploadOrganizationKnowledgeBaseDocument(
        "org_parent",
        attachment
      );

      const other = await profiles.uploadOrganizationKnowledgeBaseDocument(
        "org_parent",
        source()
      );

      const publication = await orgService.publishSharedResource(
        "org_parent",
        { resourceId: uploaded.document.id, resourceKind: "knowledge" },
        "user_creator"
      );

      const retained = await orgService.publishSharedResource(
        "org_parent",
        { resourceId: other.document.id, resourceKind: "knowledge" },
        "user_creator"
      );

      const foreign = await db.publishOrgSharedResource({
        ...publication,
        id: `foreign_${publication.id}`,
        orgId: "org_other",
      });

      if (action === "replace") {
        const skipped = await profiles.uploadOrganizationKnowledgeBaseDocument(
          "org_parent",
          attachment,
          "skip"
        );

        expect(skipped.document.id).toBe(uploaded.document.id);
        expect(
          await db.getOrgSharedResource("org_parent", publication.id)
        ).toEqual(publication);

        const replacement =
          await profiles.uploadOrganizationKnowledgeBaseDocument(
            "org_parent",
            attachment,
            "replace"
          );

        expect(replacement.outcome).toBe("replaced");
        expect(replacement.document.id).not.toBe(uploaded.document.id);
      } else {
        expect(
          await profiles.deleteOrganizationKnowledgeBaseDocument(
            "org_parent",
            uploaded.document.id
          )
        ).toEqual({ deleted: true, documentId: uploaded.document.id });
      }

      expect(await db.listOrgSharedResources("org_parent")).toEqual([retained]);
      expect(await db.getOrgSharedResource("org_other", foreign.id)).toEqual(
        foreign
      );
      expect(
        (
          await profiles.listOrganizationKnowledgeBase("org_parent")
        ).documents.some((document) => document.id === uploaded.document.id)
      ).toBe(false);
      await expect(
        orgService.publishSharedResource(
          "org_parent",
          {
            resourceId: uploaded.document.id,
            resourceKind: "knowledge",
          },
          "user_creator"
        )
      ).rejects.toMatchObject({ status: 404 });
    });
  }

  test("a document deletion retry completes failed publication removal", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const profiles = new ProfileService(db);

    const uploaded = await profiles.uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      source()
    );

    const publication = await orgService.publishSharedResource(
      "org_parent",
      {
        resourceId: uploaded.document.id,
        resourceKind: "knowledge",
      },
      "user_creator"
    );

    const failure = spyOn(db, "deleteOrgSharedResource").mockRejectedValueOnce(
      new Error("database unavailable")
    );

    try {
      await expect(
        profiles.deleteOrganizationKnowledgeBaseDocument(
          "org_parent",
          uploaded.document.id
        )
      ).rejects.toThrow();
      expect(
        await db.getOrgSharedResource("org_parent", publication.id)
      ).toEqual(publication);
      expect(
        (await profiles.listOrganizationKnowledgeBase("org_parent")).documents
      ).toEqual([]);
    } finally {
      failure.mockRestore();
    }

    await expect(
      profiles.deleteOrganizationKnowledgeBaseDocument(
        "org_parent",
        uploaded.document.id
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
  });

  test("document deletion waits for an in-flight publication and then revokes it", async () => {
    const { orgService, databaseAdapter: db } = createOrgService();
    await seedTeamParent(db);
    const profiles = new ProfileService(db);

    const uploaded = await profiles.uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      source()
    );

    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const publish = db.publishOrgSharedResource.bind(db);

    const pendingWrite = spyOn(
      db,
      "publishOrgSharedResource"
    ).mockImplementation(async (record) => {
      entered.resolve();
      await release.promise;

      return publish(record);
    });

    const publishing = orgService.publishSharedResource(
      "org_parent",
      {
        resourceId: uploaded.document.id,
        resourceKind: "knowledge",
      },
      "user_creator"
    );

    await entered.promise;

    const deleting = profiles.deleteOrganizationKnowledgeBaseDocument(
      "org_parent",
      uploaded.document.id
    );

    try {
      expect(
        await Promise.race([
          deleting.then(() => true),
          Bun.sleep(20).then(() => false),
        ])
      ).toBe(false);
      expect(
        (
          await profiles.listOrganizationKnowledgeBase("org_parent")
        ).documents.map((document) => document.id)
      ).toEqual([uploaded.document.id]);
    } finally {
      release.resolve();
      await Promise.allSettled([publishing, deleting]);
      pendingWrite.mockRestore();
    }

    await expect(publishing).resolves.toMatchObject({
      resourceId: uploaded.document.id,
    });
    await expect(deleting).resolves.toEqual({
      deleted: true,
      documentId: uploaded.document.id,
    });
    expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
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

  test("parent members, unrelated users, and team admins cannot publish or remove parent documents", async () => {
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

    for (const actor of [
      "user_secondary_member",
      "user_other",
      "user_missing",
    ]) {
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

  for (const kind of ["manifest", "directory"] as const) {
    test.skipIf(process.platform === "win32")(
      `foreign knowledge ${kind} links block catalogs and publication`,
      async () => {
        const { orgService, databaseAdapter: db } = createOrgService();
        await seedTeamParent(db);
        const profileService = new ProfileService(db);

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

        const dir = getOrgKnowledgeBaseDir("org_parent");
        const manifestPath = getKnowledgeBaseManifestPath(dir);
        const manifest = await readFile(manifestPath, "utf8");

        const original = await readFile(
          getKnowledgeBaseStoredDocumentPath(
            dir,
            document.id,
            document.filename
          )
        );

        const privateDir = join(
          getOrgConfigDir("org_other"),
          crypto.randomUUID()
        );

        const privateManifest = getKnowledgeBaseManifestPath(privateDir);

        const privateStored = getKnowledgeBaseStoredDocumentPath(
          privateDir,
          document.id,
          document.filename
        );

        await mkdir(dirname(privateStored), { recursive: true });
        await writeFile(privateManifest, manifest);
        await writeFile(privateStored, original);
        const linkedPath = kind === "manifest" ? manifestPath : dir;
        await rm(linkedPath, { recursive: kind === "directory" });
        await symlink(
          kind === "manifest" ? privateManifest : privateDir,
          linkedPath
        );

        await expect(
          profileService.listOrganizationKnowledgeBase("org_parent")
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          orgService.publishSharedResource(
            "org_parent",
            request,
            "user_creator"
          )
        ).rejects.toMatchObject({ status: 404 });
        expect(await db.listOrgSharedResources("org_parent")).toEqual([
          publication,
        ]);
        expect(
          (await orgService.listSharedResources("org_parent", "user_creator"))
            .resources
        ).toMatchObject([{ id: publication.id, readiness: "unavailable" }]);
        expect(await readFile(privateManifest, "utf8")).toBe(manifest);
        expect(await readFile(privateStored)).toEqual(original);
      }
    );
  }

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

    for (const actor of ["user_secondary_member", "user_other", "missing"]) {
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
