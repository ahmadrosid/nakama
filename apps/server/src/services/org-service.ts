import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  createEmailOutboundAdapter,
  type EmailOutboundAdapter,
  generateTemporaryPassword,
  getOrgConfigDir,
  getProfileSoulDir,
  initSoulDirectory,
  NakamaApiError,
  resolveWebPublicUrl,
} from "@nakama/core";
import {
  listChannelOwners,
  removeChannelConnection,
} from "@nakama/core/channel-config-shared";
import type {
  AcceptOrgInviteRequest,
  AddOrgMemberResponse,
  ApiKeySummary,
  AuthUserResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  ListApiKeysResponse,
  ListOrgMembersResponse,
  ListUserOrgsResponse,
  OrganizationSummary,
  OrgInviteCreatedResponse,
  OrgInviteSummary,
  OrgMemberResponse,
  OrgMemberSummary,
  OrgRole,
  RequestPasswordResetResponse,
  ResetPasswordRequest,
  RotateApiKeyResponse,
  UpdateOrganizationRequest,
  UpdateOrgMemberRequest,
  UserOrgSummary,
} from "@nakama/core/contract";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import type {
  DatabaseAdapter,
  StoredApiKeyRecord,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
  StoredPasswordResetTokenRecord,
  StoredUserRecord,
} from "@nakama/db";
import {
  ensureLocalClientAccess,
  ORG_INVITE_EXPIRY_DAYS,
  ORG_ROLES,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "@nakama/db";
import type { AuthService } from "./auth-service";
import { loadMfaPolicy } from "./mfa-config";

const LAST_MEMBERSHIP_MESSAGE =
  "Cannot archive your last remaining organization.";
const LAST_ORGANIZATION_MESSAGE =
  "Cannot archive the last remaining organization.";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+0-9()\-\s]{6,32}$/;
const MAX_MEMBER_NAME_LENGTH = 120;
const PASSWORD_RESET_EXPIRY_MINUTES = 60;
const MEMBER_NAME_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
/** Path `userId` for org member routes — matches minted ids (`user_` + hex) and seeded ones. */
const ORG_MEMBER_USER_ID_PATTERN = /^user_[A-Za-z0-9_]{1,64}$/;

function assertOrgMemberUserIdShape(userId: string): void {
  if (!ORG_MEMBER_USER_ID_PATTERN.test(userId)) {
    throw new NakamaApiError("Invalid user id.", 400);
  }
}

export class OrgService {
  beforeArchiveChannels?: (orgId: string) => Promise<() => void>;
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
    private readonly email: EmailOutboundAdapter = createEmailOutboundAdapter(),
    private readonly getWebPublicUrl: () =>
      | string
      | undefined = resolveWebPublicUrl
  ) {}

  async listOrganizations(): Promise<OrganizationSummary[]> {
    const organizations = await this.databaseAdapter.listOrganizations();
    return organizations.map(toOrganizationSummary);
  }

  async getOrganization(orgId: string): Promise<OrganizationSummary | null> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);
    return org ? toOrganizationSummary(org) : null;
  }

  private async requireActiveOrganization(
    orgId: string
  ): Promise<StoredOrganizationRecord> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);
    if (!org || org.archivedAt) {
      throw new NakamaApiError("Not found", 404);
    }
    return org;
  }

  async archiveOrganization(
    orgId: string,
    actorUserId?: string
  ): Promise<OrganizationSummary> {
    const org = await this.requireActiveOrganization(orgId);

    if (actorUserId) {
      const memberships =
        await this.databaseAdapter.listUserOrganizations(actorUserId);
      const onlyMembership =
        memberships.length === 1 && memberships[0]?.organization.id === orgId;
      if (onlyMembership) {
        throw new NakamaApiError(LAST_MEMBERSHIP_MESSAGE, 409);
      }
    }

    const now = new Date().toISOString();
    if (
      (await this.databaseAdapter.listOrganizations()).filter(
        (entry) => !entry.archivedAt
      ).length <= 1
    ) {
      throw new NakamaApiError(LAST_ORGANIZATION_MESSAGE, 409);
    }
    const releaseAdmission = await this.beforeArchiveChannels?.(orgId);
    const archived = await this.databaseAdapter
      .tryMarkOrganizationArchived(orgId, now)
      .finally(() => releaseAdmission?.());
    if (!archived) {
      const current = await this.databaseAdapter.getOrganizationById(orgId);
      if (!current || current.archivedAt) {
        throw new NakamaApiError("Not found", 404);
      }
      throw new NakamaApiError(LAST_ORGANIZATION_MESSAGE, 409);
    }

    return toOrganizationSummary({
      ...org,
      archivedAt: now,
      updatedAt: now,
    });
  }

  async permanentlyDeleteOrganization(orgId: string): Promise<void> {
    const organization = await this.databaseAdapter.getOrganizationById(orgId);
    if (!organization) {
      throw new NakamaApiError("Not found", 404);
    }
    if (!organization.archivedAt) {
      throw new NakamaApiError(
        "Archive the organization before deleting it permanently.",
        409
      );
    }

    for (const platform of [
      "telegram",
      "discord",
      "whatsapp",
      "slack",
    ] as const) {
      for (const owner of await listChannelOwners(platform)) {
        if (owner.orgId === orgId) {
          await removeChannelConnection(platform, owner);
        }
      }
    }
    // Keep the database row available for a safe retry if disk cleanup fails.
    await rm(getOrgConfigDir(orgId), { force: true, recursive: true });
    const deleted = await this.databaseAdapter.deleteOrganization(orgId);
    if (!deleted) {
      throw new NakamaApiError("Not found", 404);
    }
  }

  async updateOrganization(
    orgId: string,
    request: UpdateOrganizationRequest
  ): Promise<OrganizationSummary> {
    const org = await this.requireActiveOrganization(orgId);

    const name = request.name === undefined ? org.name : request.name.trim();
    if (request.name !== undefined && !name) {
      throw new NakamaApiError("Organization name is required.", 400);
    }

    const now = new Date().toISOString();
    const monthlyLlmTokenLimit =
      request.monthlyLlmTokenLimit === undefined
        ? (org.monthlyLlmTokenLimit ?? 0)
        : request.monthlyLlmTokenLimit;
    const monthlyLlmTurnLimit =
      request.monthlyLlmTurnLimit === undefined
        ? (org.monthlyLlmTurnLimit ?? 0)
        : request.monthlyLlmTurnLimit;
    const monthlyLlmWarningPercent =
      request.monthlyLlmWarningPercent === undefined
        ? (org.monthlyLlmWarningPercent ?? 80)
        : request.monthlyLlmWarningPercent;
    assertMonthlyLlmTurnLimit(monthlyLlmTokenLimit);
    assertMonthlyLlmTurnLimit(monthlyLlmTurnLimit);
    if (
      !Number.isInteger(monthlyLlmWarningPercent) ||
      monthlyLlmWarningPercent < 1 ||
      monthlyLlmWarningPercent > 99
    ) {
      throw new NakamaApiError(
        "Monthly LLM warning percent must be an integer from 1 to 99.",
        400
      );
    }
    const skillsCuratorStaleAfterDays =
      request.skillsCuratorStaleAfterDays === undefined
        ? (org.skillsCuratorStaleAfterDays ?? 30)
        : request.skillsCuratorStaleAfterDays;
    const skillsCuratorArchiveAfterDays =
      request.skillsCuratorArchiveAfterDays === undefined
        ? (org.skillsCuratorArchiveAfterDays ?? 90)
        : request.skillsCuratorArchiveAfterDays;
    assertSkillCuratorFreshnessClocks(
      skillsCuratorStaleAfterDays,
      skillsCuratorArchiveAfterDays
    );
    const updated: StoredOrganizationRecord = {
      ...org,
      monthlyLlmTokenLimit,
      monthlyLlmTurnLimit,
      monthlyLlmWarningPercent,
      name,
      skillsCuratorArchiveAfterDays,
      skillsCuratorConsolidateEnabled:
        request.skillsCuratorConsolidateEnabled === undefined
          ? (org.skillsCuratorConsolidateEnabled ?? false)
          : request.skillsCuratorConsolidateEnabled,
      skillsCuratorEnabled:
        request.skillsCuratorEnabled === undefined
          ? (org.skillsCuratorEnabled ?? false)
          : request.skillsCuratorEnabled,
      skillsCuratorLastRunAt: org.skillsCuratorLastRunAt ?? null,
      skillsCuratorStaleAfterDays,
      skillsPostTurnReview:
        request.skillsPostTurnReview === undefined
          ? (org.skillsPostTurnReview ?? false)
          : request.skillsPostTurnReview,
      skillsWriteApproval:
        request.skillsWriteApproval === undefined
          ? (org.skillsWriteApproval ?? false)
          : request.skillsWriteApproval,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertOrganization(updated);
    return toOrganizationSummary(updated);
  }

  async markSkillsCuratorRan(orgId: string, ranAt: string): Promise<void> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);
    if (!org) {
      throw new NakamaApiError("Not found", 404);
    }

    await this.databaseAdapter.upsertOrganization({
      ...org,
      skillsCuratorLastRunAt: ranAt,
      updatedAt: ranAt,
    });
  }

  async listSkillCuratorOrgs(): Promise<
    Array<{
      id: string;
      skillsCuratorEnabled: boolean;
      skillsCuratorLastRunAt: string | null;
    }>
  > {
    const organizations = await this.databaseAdapter.listOrganizations();
    return organizations
      .filter((org) => org.skillsCuratorEnabled && !org.archivedAt)
      .map((org) => ({
        id: org.id,
        skillsCuratorEnabled: true,
        skillsCuratorLastRunAt: org.skillsCuratorLastRunAt ?? null,
      }));
  }

  async createOrganization(
    request: CreateOrganizationRequest,
    creatorUserId?: string
  ): Promise<CreateOrganizationResponse> {
    const organization = await this.insertOrganization(request);

    if (request.admin) {
      const adminMember = await this.addMember({
        email: request.admin.email,
        name: request.admin.name,
        orgId: organization.id,
        phone: request.admin.phone,
        role: "admin",
      });

      return { adminMember, organization };
    }

    if (creatorUserId) {
      const creator = await this.databaseAdapter.getUserById(creatorUserId);
      if (creator) {
        const now = new Date().toISOString();
        await this.databaseAdapter.upsertOrgMember({
          createdAt: now,
          orgId: organization.id,
          role: "admin",
          userId: creator.id,
        });

        return {
          adminMember: {
            member: toOrgMemberSummary(creator, "admin", now),
            temporaryPassword: null,
          },
          organization,
        };
      }
    }

    return { organization };
  }

  async listUserOrgs(
    userId: string,
    orgId?: string | null
  ): Promise<ListUserOrgsResponse> {
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);
    const scopedMemberships =
      orgId === undefined
        ? memberships
        : memberships.filter(
            (membership) => membership.organization.id === orgId
          );
    return {
      orgs: scopedMemberships.map((membership) => ({
        ...toOrganizationSummary(membership.organization),
        role: membership.role,
      })),
    };
  }

  async resolveActiveOrgId(
    userId: string,
    sessionId?: string,
    requestedOrgId?: string | null
  ): Promise<string | null> {
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);
    if (memberships.length === 0) {
      if (sessionId) {
        await this.databaseAdapter.updateBrowserSessionActiveOrgId(
          sessionId,
          null
        );
      }
      return null;
    }

    const trimmed = requestedOrgId?.trim();
    const matched = trimmed
      ? memberships.find((membership) => membership.organization.id === trimmed)
      : undefined;
    const activeOrgId =
      matched?.organization.id ?? memberships[0].organization.id;

    if (sessionId && activeOrgId !== (trimmed ?? null)) {
      await this.databaseAdapter.updateBrowserSessionActiveOrgId(
        sessionId,
        activeOrgId
      );
    }

    return activeOrgId;
  }

  async setActiveOrg(input: {
    userId: string;
    orgId: string;
    sessionId?: string;
  }): Promise<UserOrgSummary> {
    const memberships = await this.databaseAdapter.listUserOrganizations(
      input.userId
    );
    const membership = memberships.find(
      (record) => record.organization.id === input.orgId
    );

    if (!membership) {
      throw new NakamaApiError("Not found", 404);
    }

    if (input.sessionId) {
      await this.databaseAdapter.updateBrowserSessionActiveOrgId(
        input.sessionId,
        membership.organization.id
      );
    }

    return {
      ...toOrganizationSummary(membership.organization),
      role: membership.role,
    };
  }

  async buildAuthUserResponse(
    user: StoredUserRecord,
    sessionId?: string,
    requestedOrgId?: string | null
  ): Promise<AuthUserResponse> {
    const activeOrgId = await this.resolveActiveOrgId(
      user.id,
      sessionId,
      requestedOrgId
    );
    const activeMember = activeOrgId
      ? await this.databaseAdapter.getOrgMember(activeOrgId, user.id)
      : null;
    const mfaPolicy = await loadMfaPolicy();
    const passkeyEnabled =
      (await this.databaseAdapter.listPasskeys(user.id)).length > 0;
    const backupCodesEnabled =
      (await this.databaseAdapter.countUnusedMfaBackupCodes(user.id)) > 0;
    return {
      activeOrgId,
      backupCodesEnabled,
      email: user.email,
      id: user.id,
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      mfaEnabled: Boolean(user.mfaEnabled),
      mfaEnrolled: Boolean(
        (user.mfaEnabled && user.mfaTotpSecretEnc) || passkeyEnabled
      ),
      mfaRequired:
        mfaPolicy.enabled &&
        mfaPolicy.required &&
        (activeMember
          ? mfaPolicy.enforcedRoles.includes(activeMember.role)
          : false),
      name: user.name ?? null,
      orgId: activeOrgId,
      passkeyEnabled,
      phone: user.phone ?? null,
    };
  }

  async updateOwnProfile(
    userId: string,
    input: {
      currentPassword?: string;
      name?: string | null;
      email?: string;
      phone?: string | null;
    }
  ): Promise<AuthUserResponse> {
    const user = await this.databaseAdapter.getUserById(userId);
    if (!user) {
      throw new NakamaApiError("Authentication required", 401);
    }

    const now = new Date().toISOString();
    const name =
      input.name === undefined
        ? (user.name ?? null)
        : normalizeOptionalName(input.name);
    const phone =
      input.phone === undefined
        ? (user.phone ?? null)
        : normalizeOptionalPhone(input.phone);
    let email = user.email;

    if (input.email !== undefined) {
      email = normalizeEmail(input.email);
      if (!EMAIL_PATTERN.test(email)) {
        throw new NakamaApiError("A valid email address is required.", 400);
      }

      if (email !== user.email) {
        const validPassword = await this.authService.verifyPassword(
          input.currentPassword?.trim() ?? "",
          user.passwordHash
        );
        if (!validPassword) {
          throw new NakamaApiError("Current password is incorrect.", 401);
        }

        const existing = await this.databaseAdapter.getUserByEmail(email);
        if (existing && existing.id !== user.id) {
          throw new NakamaApiError(
            "An account with that email already exists.",
            409
          );
        }
      }
    }

    if (user.name !== name || user.phone !== phone || user.email !== email) {
      await this.databaseAdapter.updateUserProfile(
        userId,
        {
          name,
          phone,
          ...(email === user.email ? {} : { email }),
        },
        now
      );
    }

    return this.buildAuthUserResponse({
      ...user,
      email,
      name,
      phone,
      updatedAt: now,
    });
  }

  async addMember(input: {
    orgId: string;
    name: string;
    email: string;
    phone: string;
    role: OrgRole;
  }): Promise<AddOrgMemberResponse> {
    await this.requireActiveOrganization(input.orgId);

    const name = input.name.trim();
    const email = normalizeEmail(input.email);
    const phone = normalizeOptionalPhone(input.phone);

    assertMemberName(name);

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    if (!ORG_ROLES.includes(input.role)) {
      throw new NakamaApiError("Invalid org role.", 400);
    }

    const now = new Date().toISOString();
    const existingUser = await this.databaseAdapter.getUserByEmail(email);

    if (existingUser) {
      const member = await this.databaseAdapter.getOrgMember(
        input.orgId,
        existingUser.id
      );
      if (member) {
        throw new NakamaApiError(
          "User is already a member of this organization.",
          409
        );
      }

      await this.databaseAdapter.upsertOrgMember({
        createdAt: now,
        orgId: input.orgId,
        role: input.role,
        userId: existingUser.id,
      });

      return {
        member: toOrgMemberSummary(existingUser, input.role, now),
        temporaryPassword: null,
      };
    }

    const temporaryPassword = generateTemporaryPassword();
    const user: StoredUserRecord = {
      createdAt: now,
      email,
      id: `user_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      passwordHash: await this.authService.hashPassword(temporaryPassword),
      phone,
      updatedAt: now,
    };

    await this.databaseAdapter.createUser(user);
    await this.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: input.orgId,
      role: input.role,
      userId: user.id,
    });

    return {
      member: toOrgMemberSummary(user, input.role, now),
      temporaryPassword,
    };
  }

  async bootstrapInitialSetup(input: {
    organization: { name: string; slug: string };
    admin: {
      name: string;
      email: string;
      phone: string;
      passwordHash: string;
    };
  }): Promise<{ user: StoredUserRecord; organization: OrganizationSummary }> {
    // Validate before the insert: a rejected admin used to leave the org behind,
    // and the retry then failed on the slug it had just taken.
    const name = input.admin.name.trim();
    const email = normalizeEmail(input.admin.email);
    const phone = normalizeOptionalPhone(input.admin.phone);

    if (!name) {
      throw new NakamaApiError("Admin name is required.", 400);
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    const organization = await this.buildOrganizationRecord(input.organization);
    const now = new Date().toISOString();
    const user: StoredUserRecord = {
      createdAt: now,
      email,
      id: "user_admin",
      isPlatformAdmin: true,
      name,
      passwordHash: input.admin.passwordHash,
      phone,
      updatedAt: now,
    };

    // One transaction, so a second concurrent setup that also passed the
    // route's human-user check loses here instead of committing an org it
    // can never become a member of.
    const claimed = await this.databaseAdapter.bootstrapInitialSetup({
      member: {
        createdAt: now,
        orgId: organization.id,
        role: "admin",
        userId: user.id,
      },
      organization,
      user,
    });
    if (!claimed) {
      throw new NakamaApiError("Admin user already exists", 409);
    }

    await this.seedOrgProfiles(organization.id);
    await ensureLocalClientAccess(this.databaseAdapter);

    return { organization: toOrganizationSummary(organization), user };
  }

  async listMembers(orgId: string): Promise<ListOrgMembersResponse> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);
    if (!org) {
      throw new NakamaApiError("Not found", 404);
    }

    const records = await this.databaseAdapter.listOrgMembers(orgId);
    const members: OrgMemberSummary[] = [];

    for (const record of records) {
      if (record.userId === LOCAL_CLIENT_USER_ID) {
        continue;
      }

      const user = await this.databaseAdapter.getUserById(record.userId);
      if (!user) {
        continue;
      }

      members.push(toOrgMemberSummary(user, record.role, record.createdAt));
    }

    return { members };
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    assertOrgMemberUserIdShape(userId);
    await this.requireActiveOrganization(orgId);
    await this.assertCanChangeAdminMembership(orgId, userId);

    const deleted = await this.databaseAdapter.deleteOrgMember(orgId, userId);
    if (!deleted) {
      // The delete carries the last-admin guard, so a concurrent change between
      // the check above and here lands here rather than emptying the org.
      await this.assertCanChangeAdminMembership(orgId, userId);
      throw new NakamaApiError("Not found", 404);
    }

    // The org middleware stops org routes for a non-member, but the cookie stays
    // valid on /v1/auth/* until it expires. Revoke like changePassword does: all
    // of the user's sessions, so a multi-org user re-authenticates rather than
    // keeping a session whose active org they were just removed from.
    await this.databaseAdapter.revokeBrowserSessionsForUser(
      userId,
      new Date().toISOString()
    );
  }

  async disableMember(orgId: string, userId: string): Promise<void> {
    assertOrgMemberUserIdShape(userId);
    await this.requireActiveOrganization(orgId);

    const member = await this.databaseAdapter.getOrgMember(orgId, userId);
    if (!member) {
      throw new NakamaApiError("Not found", 404);
    }

    // disabled_at is install-wide, not per-org, so this has to check every org
    // the user administers, not just the org named in the URL: a user can be
    // a plain member of orgId while being the sole admin of a different org,
    // and disabling never touches org_members rows, so assertCanChangeAdminMembership
    // (which only looks at one org) would miss that entirely.
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);
    const adminMemberships = memberships.filter(
      (membership) => membership.role === "admin"
    );
    for (const membership of adminMemberships) {
      const members = await this.databaseAdapter.listOrgMembers(
        membership.organization.id
      );
      const otherAdmins = members.filter(
        (entry) => entry.role === "admin" && entry.userId !== userId
      );
      const otherAdminUsers = await Promise.all(
        otherAdmins.map((entry) =>
          this.databaseAdapter.getUserById(entry.userId)
        )
      );
      const hasUsableAdmin = otherAdminUsers.some(
        (user) => user && !user.disabledAt
      );
      if (!hasUsableAdmin) {
        throw new NakamaApiError(
          "Cannot disable the last active admin of an organization.",
          409
        );
      }
    }

    // Same shape as the org-admin check: is_platform_admin is also install-wide
    // and unrelated to org membership, so a platform admin who is a plain
    // member (or not a member) everywhere would otherwise slip past the loop
    // above and could be the install's only platform admin.
    const targetUser = await this.databaseAdapter.getUserById(userId);
    if (targetUser?.isPlatformAdmin) {
      const platformAdmins =
        await this.databaseAdapter.listPlatformAdminUsers();
      const hasUsablePlatformAdmin = platformAdmins.some(
        (admin) => admin.id !== userId && !admin.disabledAt
      );
      if (!hasUsablePlatformAdmin) {
        throw new NakamaApiError(
          "Cannot disable the last active platform admin.",
          409
        );
      }
    }

    const now = new Date().toISOString();
    await this.databaseAdapter.disableUser(userId, now);
    await this.databaseAdapter.revokeBrowserSessionsForUser(userId, now);
  }

  async enableMember(orgId: string, userId: string): Promise<void> {
    assertOrgMemberUserIdShape(userId);
    await this.requireActiveOrganization(orgId);

    const member = await this.databaseAdapter.getOrgMember(orgId, userId);
    if (!member) {
      throw new NakamaApiError("Not found", 404);
    }

    await this.databaseAdapter.enableUser(userId);
  }

  /**
   * Remove login, membership and per-user integration data while retaining an
   * anonymous user anchor. Chat messages and shared artifacts are org records,
   * so they stay intact without retaining the erased person's identity.
   */
  async eraseUser(userId: string, actorUserId: string): Promise<void> {
    assertOrgMemberUserIdShape(userId);
    if (userId === actorUserId) {
      throw new NakamaApiError("You cannot erase your own account.", 409);
    }

    const user = await this.databaseAdapter.getUserById(userId);
    if (!user) {
      throw new NakamaApiError("Not found", 404);
    }

    const updatedAt = new Date().toISOString();
    const erased = await this.databaseAdapter.eraseUser({
      email: `erased-${crypto.randomUUID()}@deleted.invalid`,
      id: userId,
      passwordHash: await this.authService.hashPassword(crypto.randomUUID()),
      updatedAt,
    });
    if (!erased) {
      throw new NakamaApiError("Not found", 404);
    }
  }

  async updateMember(
    orgId: string,
    userId: string,
    input: UpdateOrgMemberRequest
  ): Promise<OrgMemberResponse> {
    await this.requireActiveOrganization(orgId);

    const nextRole = input.role;
    if (nextRole !== undefined && !ORG_ROLES.includes(nextRole)) {
      throw new NakamaApiError("Invalid org role.", 400);
    }

    const member = await this.assertCanChangeAdminMembership(
      orgId,
      userId,
      nextRole
    );
    const user = await this.databaseAdapter.getUserById(userId);
    if (!user) {
      throw new NakamaApiError("Not found", 404);
    }

    const now = new Date().toISOString();
    const name =
      input.name === undefined
        ? (user.name ?? null)
        : normalizeOptionalName(input.name);
    const phone =
      input.phone === undefined
        ? (user.phone ?? null)
        : normalizeOptionalPhone(input.phone);
    const role = nextRole ?? member.role;

    if (user.name !== name || user.phone !== phone) {
      await this.databaseAdapter.updateUserProfile(
        userId,
        { name, phone },
        now
      );
    }

    if (member.role !== role) {
      const updated = await this.databaseAdapter.updateOrgMemberRole(
        orgId,
        userId,
        role
      );
      if (!updated) {
        await this.assertCanChangeAdminMembership(orgId, userId, role);
        throw new NakamaApiError("Not found", 404);
      }
    }

    return {
      member: toOrgMemberSummary(
        { ...user, name, phone, updatedAt: now },
        role,
        member.createdAt
      ),
    };
  }

  async listApiKeys(orgId: string): Promise<ListApiKeysResponse> {
    await this.requireActiveOrganization(orgId);
    const keys = await this.databaseAdapter.listApiKeysForOrg(orgId);
    return { keys: keys.map(toApiKeySummary) };
  }

  async createApiKey(input: {
    orgId: string;
    userId: string;
    request: CreateApiKeyRequest;
  }): Promise<CreateApiKeyResponse> {
    await this.requireActiveOrganization(input.orgId);
    const { expiresAt, name } = input.request;
    const environment = "live" as const;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 120) {
      throw new NakamaApiError(
        "A key name from 1 to 120 characters is required.",
        400
      );
    }
    if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
      throw new NakamaApiError("Invalid expiration date.", 400);
    }

    const secret = randomBytes(32).toString("hex");
    const rawKey = `nk_${environment}_${secret}`;
    const record: StoredApiKeyRecord = {
      createdAt: new Date().toISOString(),
      createdByUserId: input.userId,
      environment,
      expiresAt: expiresAt ?? null,
      id: `key_${crypto.randomUUID().replace(/-/g, "")}`,
      keyPrefix: rawKey.slice(0, 20),
      lastUsedAt: null,
      name: trimmedName,
      orgId: input.orgId,
      revokedAt: null,
      secretHash: this.authService.hashToken(rawKey),
    };

    await this.databaseAdapter.createApiKey(record);
    await this.databaseAdapter.createAuditEvent({
      action: "api_key.create",
      actorUserId: input.userId,
      createdAt: record.createdAt,
      id: `audit_${crypto.randomUUID().replace(/-/g, "")}`,
      metadata: { environment: record.environment },
      orgId: input.orgId,
      requestId: null,
      resourceId: record.id,
      resourceType: "api_key",
    });
    return { key: toApiKeySummary(record), secret: rawKey };
  }

  async revokeApiKey(
    orgId: string,
    userId: string,
    keyId: string
  ): Promise<void> {
    await this.requireActiveOrganization(orgId);
    const key = (await this.databaseAdapter.listApiKeysForOrg(orgId)).find(
      (candidate) => candidate.id === keyId
    );
    if (
      !(
        key &&
        (await this.databaseAdapter.revokeApiKey(
          keyId,
          new Date().toISOString()
        ))
      )
    ) {
      throw new NakamaApiError("Not found", 404);
    }
    await this.databaseAdapter.createAuditEvent({
      action: "api_key.revoke",
      actorUserId: userId,
      createdAt: new Date().toISOString(),
      id: `audit_${crypto.randomUUID().replace(/-/g, "")}`,
      metadata: {},
      orgId,
      requestId: null,
      resourceId: keyId,
      resourceType: "api_key",
    });
  }

  async deleteApiKey(
    orgId: string,
    userId: string,
    keyId: string
  ): Promise<void> {
    await this.requireActiveOrganization(orgId);
    const key = (await this.databaseAdapter.listApiKeysForOrg(orgId)).find(
      (candidate) => candidate.id === keyId
    );
    if (!(key && (await this.databaseAdapter.deleteApiKey(keyId)))) {
      throw new NakamaApiError("Not found", 404);
    }
    await this.databaseAdapter.createAuditEvent({
      action: "api_key.delete",
      actorUserId: userId,
      createdAt: new Date().toISOString(),
      id: `audit_${crypto.randomUUID().replace(/-/g, "")}`,
      metadata: {},
      orgId,
      requestId: null,
      resourceId: keyId,
      resourceType: "api_key",
    });
  }

  async rotateApiKey(
    orgId: string,
    userId: string,
    keyId: string
  ): Promise<RotateApiKeyResponse> {
    await this.requireActiveOrganization(orgId);
    const keys = await this.databaseAdapter.listApiKeysForOrg(orgId);
    const current = keys.find((key) => key.id === keyId);
    if (!current || current.revokedAt) {
      throw new NakamaApiError("Not found", 404);
    }
    const revoked = await this.databaseAdapter.revokeApiKey(
      keyId,
      new Date().toISOString()
    );
    if (!revoked) {
      throw new NakamaApiError("Not found", 404);
    }
    const created = await this.createApiKey({
      orgId,
      request: {
        environment: current.environment as CreateApiKeyRequest["environment"],
        expiresAt: current.expiresAt,
        name: current.name,
      },
      userId,
    });
    await this.databaseAdapter.createAuditEvent({
      action: "api_key.rotate",
      actorUserId: userId,
      createdAt: new Date().toISOString(),
      id: `audit_${crypto.randomUUID().replace(/-/g, "")}`,
      metadata: {},
      orgId,
      requestId: null,
      resourceId: keyId,
      resourceType: "api_key",
    });
    return created;
  }

  async createInvite(input: {
    orgId: string;
    email: string;
    role: OrgRole;
    invitedByUserId: string;
  }): Promise<OrgInviteCreatedResponse> {
    const organization = await this.requireActiveOrganization(input.orgId);

    const email = normalizeEmail(input.email);
    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    if (!ORG_ROLES.includes(input.role)) {
      throw new NakamaApiError("Invalid org role.", 400);
    }

    const existingUser = await this.databaseAdapter.getUserByEmail(email);
    if (existingUser) {
      const member = await this.databaseAdapter.getOrgMember(
        input.orgId,
        existingUser.id
      );
      if (member) {
        throw new NakamaApiError(
          "User is already a member of this organization.",
          409
        );
      }
    }

    const pendingInvite = await this.databaseAdapter.getPendingOrgInvite(
      input.orgId,
      email
    );
    if (pendingInvite) {
      throw new NakamaApiError(
        "An invite is already pending for this email.",
        409
      );
    }

    const now = new Date();
    const token = generateInviteToken();
    const record: StoredOrgInviteRecord = {
      acceptedAt: null,
      createdAt: now.toISOString(),
      email,
      expiresAt: new Date(
        now.getTime() + ORG_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      id: `invite_${crypto.randomUUID().replace(/-/g, "")}`,
      invitedByUserId: input.invitedByUserId,
      orgId: input.orgId,
      revokedAt: null,
      role: input.role,
      tokenHash: this.authService.hashToken(token),
    };

    await this.databaseAdapter.createOrgInvite(record);

    const webPublicUrl = this.getWebPublicUrl();
    const acceptInstruction = webPublicUrl
      ? `Accept your invitation: ${webPublicUrl}/accept-invite?token=${encodeURIComponent(token)}`
      : `Invitation token: ${token}`;
    const delivery = await this.email.send({
      orgId: input.orgId,
      subject: `You're invited to ${organization.name}`,
      text: [
        `You've been invited to join ${organization.name} as ${input.role}.`,
        "",
        acceptInstruction,
        "",
        `This invitation expires on ${record.expiresAt}.`,
      ].join("\n"),
      to: email,
    });

    return {
      delivered: delivery.ok,
      invite: toOrgInviteSummary(record),
      token: delivery.ok ? null : token,
    };
  }

  async acceptInvite(request: AcceptOrgInviteRequest): Promise<{
    user: StoredUserRecord;
    orgId: string;
    role: OrgRole;
  }> {
    const token = request.token?.trim();
    if (!token) {
      throw new NakamaApiError("Invite token is required.", 400);
    }

    const invite = await this.databaseAdapter.getOrgInviteByTokenHash(
      this.authService.hashToken(token)
    );
    if (!invite) {
      throw new NakamaApiError("Not found", 404);
    }

    assertInviteUsable(invite);

    await this.requireActiveOrganization(invite.orgId);

    const password = request.password?.trim();
    if (!password) {
      throw new NakamaApiError(
        "Password is required to accept an invite.",
        400
      );
    }

    assertNewPassword(password);

    const now = new Date().toISOString();
    let user = await this.databaseAdapter.getUserByEmail(invite.email);

    if (user) {
      const valid = await this.authService.verifyPassword(
        password,
        user.passwordHash
      );
      if (!valid) {
        throw new NakamaApiError("Invalid credentials", 401);
      }
    } else {
      user = {
        createdAt: now,
        email: invite.email,
        id: `user_${crypto.randomUUID().replace(/-/g, "")}`,
        passwordHash: await this.authService.hashPassword(password),
        updatedAt: now,
      };
      await this.databaseAdapter.createUser(user);
    }

    const existingMember = await this.databaseAdapter.getOrgMember(
      invite.orgId,
      user.id
    );
    if (existingMember) {
      throw new NakamaApiError(
        "User is already a member of this organization.",
        409
      );
    }

    await this.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: invite.orgId,
      role: invite.role,
      userId: user.id,
    });
    await this.databaseAdapter.markOrgInviteAccepted(invite.id, now);

    return {
      orgId: invite.orgId,
      role: invite.role,
      user,
    };
  }

  async requestPasswordReset(
    requestedEmail: string,
    allowManualToken = false
  ): Promise<RequestPasswordResetResponse> {
    const email = normalizeEmail(requestedEmail);
    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    const user = await this.databaseAdapter.getUserByEmail(email);
    if (!user) {
      // Match the successful-delivery shape so configured deployments do not
      // disclose whether an address has an account.
      return { delivered: true, token: null };
    }

    const now = new Date();
    const token = generatePasswordResetToken();
    const record: StoredPasswordResetTokenRecord = {
      consumedAt: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000
      ).toISOString(),
      id: `password_reset_${crypto.randomUUID().replace(/-/g, "")}`,
      tokenHash: this.authService.hashToken(token),
      userId: user.id,
    };
    await this.databaseAdapter.createPasswordResetToken(record);

    const webPublicUrl = this.getWebPublicUrl();
    const resetInstruction = webPublicUrl
      ? `Reset your password: ${webPublicUrl}/reset-password?token=${encodeURIComponent(token)}`
      : `Password reset token: ${token}`;
    const deliveryPromise = Promise.resolve().then(() =>
      this.email.send({
        subject: "Reset your Nakama password",
        text: [
          "A password reset was requested for your account.",
          "",
          resetInstruction,
          "",
          `This link expires on ${record.expiresAt}. If you did not request it, you can ignore this message.`,
        ].join("\n"),
        to: email,
      })
    );

    if (!allowManualToken) {
      // Public callers get a response independent of SMTP latency. The
      // adapter contains delivery errors, while this catch also protects
      // against an injected adapter rejecting unexpectedly.
      void deliveryPromise.catch(() => undefined);
      return { delivered: true, token: null };
    }

    const delivery = await deliveryPromise;
    return { delivered: delivery.ok, token: delivery.ok ? null : token };
  }

  async resetPassword(request: ResetPasswordRequest): Promise<void> {
    const token = request.token?.trim();
    if (!token) {
      throw new NakamaApiError("Password reset token is required.", 400);
    }

    const newPassword = request.newPassword?.trim() ?? "";
    assertNewPassword(newPassword);
    const consumed = await this.databaseAdapter.consumePasswordResetToken(
      this.authService.hashToken(token),
      await this.authService.hashPassword(newPassword),
      new Date().toISOString()
    );
    if (!consumed) {
      throw new NakamaApiError(
        "Password reset token is invalid or has expired.",
        400
      );
    }
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.databaseAdapter.getUserById(input.userId);
    if (!user) {
      throw new NakamaApiError("Authentication required", 401);
    }

    const currentPassword = input.currentPassword.trim();
    const newPassword = input.newPassword.trim();
    assertNewPassword(newPassword);

    const valid = await this.authService.verifyPassword(
      currentPassword,
      user.passwordHash
    );
    if (!valid) {
      throw new NakamaApiError("Current password is incorrect.", 401);
    }

    const now = new Date().toISOString();
    await this.databaseAdapter.updateUserPassword(
      user.id,
      await this.authService.hashPassword(newPassword),
      now
    );
    await this.databaseAdapter.revokeBrowserSessionsForUser(user.id, now);
  }

  private async assertCanChangeAdminMembership(
    orgId: string,
    userId: string,
    nextRole?: OrgRole
  ): Promise<{
    orgId: string;
    userId: string;
    role: OrgRole;
    createdAt: string;
  }> {
    const member = await this.databaseAdapter.getOrgMember(orgId, userId);
    if (!member) {
      throw new NakamaApiError("Not found", 404);
    }

    if (member.role !== "admin") {
      return member;
    }

    const members = await this.databaseAdapter.listOrgMembers(orgId);
    const admins = members.filter((entry) => entry.role === "admin");
    const adminUsers = await Promise.all(
      admins.map((entry) => this.databaseAdapter.getUserById(entry.userId))
    );
    // disabled_at is install-wide and does not touch org_members rows, so a raw
    // admin-row count still sees a disabled admin as usable coverage.
    const usableAdminCount = adminUsers.filter(
      (user) => user && !user.disabledAt
    ).length;
    if (usableAdminCount > 1) {
      return member;
    }

    if (nextRole !== undefined && nextRole !== "admin") {
      throw new NakamaApiError(
        "Cannot change role of the last org admin.",
        409
      );
    }

    if (nextRole === undefined) {
      throw new NakamaApiError("Cannot remove the last org admin.", 409);
    }

    return member;
  }

  private async buildOrganizationRecord(request: {
    name: string;
    slug: string;
  }): Promise<StoredOrganizationRecord> {
    const name = request.name.trim();
    const slug = request.slug.trim().toLowerCase();

    if (!name) {
      throw new NakamaApiError("Organization name is required.", 400);
    }

    if (!(slug && SLUG_PATTERN.test(slug))) {
      throw new NakamaApiError(
        "Organization slug must use lowercase letters, numbers, and hyphens.",
        400
      );
    }

    const existing = await this.databaseAdapter.getOrganizationBySlug(slug);
    if (existing) {
      throw new NakamaApiError("Organization slug already exists.", 409);
    }

    const now = new Date().toISOString();
    return {
      createdAt: now,
      id: `org_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      skillsCuratorArchiveAfterDays: 90,
      skillsCuratorStaleAfterDays: 30,
      slug,
      updatedAt: now,
    };
  }

  private async insertOrganization(
    request: CreateOrganizationRequest
  ): Promise<OrganizationSummary> {
    if (
      request.admin &&
      !(request.admin.name.trim() && request.admin.email.trim())
    ) {
      throw new NakamaApiError("Admin name and email are required.", 400);
    }

    const record = await this.buildOrganizationRecord(request);
    await this.databaseAdapter.upsertOrganization(record);
    await this.seedOrgProfiles(record.id);
    await ensureLocalClientAccess(this.databaseAdapter);
    return toOrganizationSummary(record);
  }

  private async seedOrgProfiles(orgId: string): Promise<void> {
    const defaultProfile = await seedOrgDefaultProfile(
      this.databaseAdapter,
      orgId
    );
    await initSoulDirectory(getProfileSoulDir(orgId, defaultProfile.id));

    const superBotProfile = await seedOrgSuperBotProfile(
      this.databaseAdapter,
      orgId
    );
    await initSoulDirectory(getProfileSoulDir(orgId, superBotProfile.id));
  }
}

function assertMemberName(name: string): void {
  if (!name) {
    throw new NakamaApiError("Member name is required.", 400);
  }

  if (name.length > MAX_MEMBER_NAME_LENGTH) {
    throw new NakamaApiError("Member name is too long.", 400);
  }

  if (MEMBER_NAME_CONTROL_CHARS.test(name)) {
    throw new NakamaApiError("Member name contains invalid characters.", 400);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalPhone(
  phone: string | null | undefined
): string | null {
  const trimmed = phone?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  if (!PHONE_PATTERN.test(trimmed)) {
    throw new NakamaApiError("Enter a valid phone number.", 400);
  }

  return trimmed;
}

function normalizeOptionalName(name: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed || null;
}

function generateInviteToken(): string {
  return `tc_invite_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function generatePasswordResetToken(): string {
  return `tc_reset_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function assertInviteUsable(invite: StoredOrgInviteRecord): void {
  if (invite.acceptedAt) {
    throw new NakamaApiError("Invite has already been accepted.", 400);
  }

  if (invite.revokedAt) {
    throw new NakamaApiError("Invite is no longer valid.", 400);
  }

  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    throw new NakamaApiError("Invite has expired.", 400);
  }
}

function assertSkillCuratorFreshnessClocks(
  staleAfterDays: number,
  archiveAfterDays: number
): void {
  if (
    !(Number.isInteger(staleAfterDays) && Number.isInteger(archiveAfterDays)) ||
    staleAfterDays <= 0 ||
    archiveAfterDays <= 0 ||
    staleAfterDays >= archiveAfterDays ||
    archiveAfterDays > 3650
  ) {
    throw new NakamaApiError(
      "Skill curator days must be positive integers with stale before archive and archive at most 3650 days.",
      400
    );
  }
}

function assertMonthlyLlmTurnLimit(limit: number): void {
  if (!(Number.isInteger(limit) && limit >= 0 && limit <= 1_000_000)) {
    throw new NakamaApiError(
      "Monthly LLM turn limit must be an integer from 0 to 1000000.",
      400
    );
  }
}

function assertNewPassword(password: string): void {
  if (password.length < 8) {
    throw new NakamaApiError("Password must be at least 8 characters.", 400);
  }
}

function toOrganizationSummary(
  record: StoredOrganizationRecord
): OrganizationSummary {
  return {
    archivedAt: record.archivedAt ?? null,
    createdAt: record.createdAt,
    id: record.id,
    monthlyLlmTurnLimit: record.monthlyLlmTurnLimit ?? 0,
    name: record.name,
    skillsCuratorArchiveAfterDays: record.skillsCuratorArchiveAfterDays ?? 90,
    skillsCuratorConsolidateEnabled:
      record.skillsCuratorConsolidateEnabled ?? false,
    skillsCuratorEnabled: record.skillsCuratorEnabled ?? false,
    skillsCuratorLastRunAt: record.skillsCuratorLastRunAt ?? null,
    skillsCuratorStaleAfterDays: record.skillsCuratorStaleAfterDays ?? 30,
    skillsPostTurnReview: record.skillsPostTurnReview ?? false,
    skillsWriteApproval: record.skillsWriteApproval ?? false,
    slug: record.slug,
    updatedAt: record.updatedAt,
  };
}

function toOrgInviteSummary(record: StoredOrgInviteRecord): OrgInviteSummary {
  return {
    createdAt: record.createdAt,
    email: record.email,
    expiresAt: record.expiresAt,
    id: record.id,
    orgId: record.orgId,
    role: record.role,
  };
}

function toApiKeySummary(record: StoredApiKeyRecord): ApiKeySummary {
  return {
    createdAt: record.createdAt,
    environment: record.environment as ApiKeySummary["environment"],
    expiresAt: record.expiresAt,
    id: record.id,
    keyPrefix: record.keyPrefix,
    lastUsedAt: record.lastUsedAt,
    name: record.name,
    revokedAt: record.revokedAt,
  };
}

function toOrgMemberSummary(
  user: StoredUserRecord,
  role: OrgRole,
  createdAt: string
): OrgMemberSummary {
  return {
    createdAt,
    email: user.email,
    name: user.name ?? null,
    phone: user.phone ?? null,
    role,
    userId: user.id,
  };
}
