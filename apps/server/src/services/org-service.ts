import {
  generateTemporaryPassword,
  getProfileSoulDir,
  initSoulDirectory,
  NakamaApiError,
} from "@nakama/core";
import type {
  AcceptOrgInviteRequest,
  AddOrgMemberResponse,
  AuthUserResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  ListOrgMembersResponse,
  ListUserOrgsResponse,
  OrganizationSummary,
  OrgInviteCreatedResponse,
  OrgInviteSummary,
  OrgMemberResponse,
  OrgMemberSummary,
  OrgRole,
  UpdateOrganizationRequest,
  UpdateOrgMemberRequest,
  UserOrgSummary,
} from "@nakama/core/contract";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import type {
  DatabaseAdapter,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
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

const LAST_MEMBERSHIP_MESSAGE =
  "Cannot archive your last remaining organization.";
const LAST_ORGANIZATION_MESSAGE =
  "Cannot archive the last remaining organization.";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+0-9()\-\s]{6,32}$/;

export class OrgService {
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService
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
    const archived = await this.databaseAdapter.tryMarkOrganizationArchived(
      orgId,
      now
    );
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

  async listUserOrgs(userId: string): Promise<ListUserOrgsResponse> {
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);
    return {
      orgs: memberships.map((membership) => ({
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

    return {
      activeOrgId,
      email: user.email,
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      name: user.name ?? null,
      orgId: activeOrgId,
      phone: user.phone ?? null,
    };
  }

  async updateOwnProfile(
    userId: string,
    input: {
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
    const org = await this.databaseAdapter.getOrganizationById(input.orgId);
    if (!org) {
      throw new NakamaApiError("Not found", 404);
    }

    const name = input.name.trim();
    const email = normalizeEmail(input.email);
    const phone = normalizeOptionalPhone(input.phone);

    if (!name) {
      throw new NakamaApiError("Member name is required.", 400);
    }

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
    const organization = await this.insertOrganization({
      name: input.organization.name,
      slug: input.organization.slug,
    });

    const name = input.admin.name.trim();
    const email = normalizeEmail(input.admin.email);
    const phone = normalizeOptionalPhone(input.admin.phone);

    if (!name) {
      throw new NakamaApiError("Admin name is required.", 400);
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

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

    await this.databaseAdapter.createUser(user);
    await this.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: organization.id,
      role: "admin",
      userId: user.id,
    });

    return { organization, user };
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
    await this.assertCanChangeAdminMembership(orgId, userId);

    const deleted = await this.databaseAdapter.deleteOrgMember(orgId, userId);
    if (!deleted) {
      throw new NakamaApiError("Not found", 404);
    }
  }

  async updateMember(
    orgId: string,
    userId: string,
    input: UpdateOrgMemberRequest
  ): Promise<OrgMemberResponse> {
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
      await this.databaseAdapter.upsertOrgMember({
        createdAt: member.createdAt,
        orgId,
        role,
        userId,
      });
    }

    return {
      member: toOrgMemberSummary(
        { ...user, name, phone, updatedAt: now },
        role,
        member.createdAt
      ),
    };
  }

  async createInvite(input: {
    orgId: string;
    email: string;
    role: OrgRole;
    invitedByUserId: string;
  }): Promise<OrgInviteCreatedResponse> {
    await this.requireActiveOrganization(input.orgId);

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

    return {
      invite: toOrgInviteSummary(record),
      token,
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
    const adminCount = members.filter((entry) => entry.role === "admin").length;
    if (adminCount > 1) {
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

  private async insertOrganization(
    request: CreateOrganizationRequest
  ): Promise<OrganizationSummary> {
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

    if (
      request.admin &&
      !(request.admin.name.trim() && request.admin.email.trim())
    ) {
      throw new NakamaApiError("Admin name and email are required.", 400);
    }

    const existing = await this.databaseAdapter.getOrganizationBySlug(slug);
    if (existing) {
      throw new NakamaApiError("Organization slug already exists.", 409);
    }

    const now = new Date().toISOString();
    const record: StoredOrganizationRecord = {
      createdAt: now,
      id: `org_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      skillsCuratorArchiveAfterDays: 90,
      skillsCuratorStaleAfterDays: 30,
      slug,
      updatedAt: now,
    };

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
