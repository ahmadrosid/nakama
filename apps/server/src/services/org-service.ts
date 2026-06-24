import { TinyClawApiError, generateTemporaryPassword } from "@tinyclaw/core";
import type {
  AddOrgMemberResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  ListOrgMembersResponse,
  OrgInviteCreatedResponse,
  OrgInviteSummary,
  OrgMemberResponse,
  OrgMemberSummary,
  OrgRole,
  OrganizationSummary,
  AcceptOrgInviteRequest,
  AuthUserResponse,
  ListUserOrgsResponse,
  UpdateOrgMemberRequest,
  UserOrgSummary,
} from "@tinyclaw/core/contract";
import {
  ensureLocalClientAccess,
  ORG_INVITE_EXPIRY_DAYS,
  ORG_ROLES,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "@tinyclaw/db";
import type {
  DatabaseAdapter,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
  StoredUserRecord,
} from "@tinyclaw/db";
import { getProfileSoulDir, initSoulDirectory } from "@tinyclaw/core";
import type { AuthService } from "./auth-service";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+0-9()\-\s]{6,32}$/;

export class OrgService {
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
  ) {}

  async listOrganizations(): Promise<OrganizationSummary[]> {
    const organizations = await this.databaseAdapter.listOrganizations();
    return organizations.map(toOrganizationSummary);
  }

  async updateOrganization(
    orgId: string,
    request: { name: string },
  ): Promise<OrganizationSummary> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);
    if (!org) {
      throw new TinyClawApiError("Not found", 404);
    }

    const name = request.name.trim();
    if (!name) {
      throw new TinyClawApiError("Organization name is required.", 400);
    }

    const now = new Date().toISOString();
    const updated: StoredOrganizationRecord = {
      ...org,
      name,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertOrganization(updated);
    return toOrganizationSummary(updated);
  }

  async createOrganization(
    request: CreateOrganizationRequest,
    creatorUserId?: string,
  ): Promise<CreateOrganizationResponse> {
    const organization = await this.insertOrganization(request);

    if (request.admin) {
      const adminMember = await this.addMember({
        orgId: organization.id,
        name: request.admin.name,
        email: request.admin.email,
        phone: request.admin.phone,
        role: "admin",
      });

      return { organization, adminMember };
    }

    if (creatorUserId) {
      const creator = await this.databaseAdapter.getUserById(creatorUserId);
      if (creator) {
        const now = new Date().toISOString();
        await this.databaseAdapter.upsertOrgMember({
          orgId: organization.id,
          userId: creator.id,
          role: "admin",
          createdAt: now,
        });

        return {
          organization,
          adminMember: {
            member: toOrgMemberSummary(creator, "admin", now),
            temporaryPassword: null,
          },
        };
      }
    }

    return { organization };
  }

  async listUserOrgs(userId: string): Promise<ListUserOrgsResponse> {
    const memberships = await this.databaseAdapter.listUserOrganizations(userId);
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
    requestedOrgId?: string | null,
  ): Promise<string | null> {
    const memberships = await this.databaseAdapter.listUserOrganizations(userId);
    if (memberships.length === 0) {
      return null;
    }

    const trimmed = requestedOrgId?.trim();
    const matched = trimmed
      ? memberships.find((membership) => membership.organization.id === trimmed)
      : undefined;
    const activeOrgId = matched?.organization.id ?? memberships[0]!.organization.id;

    if (sessionId && activeOrgId !== (trimmed ?? null)) {
      await this.databaseAdapter.updateBrowserSessionActiveOrgId(sessionId, activeOrgId);
    }

    return activeOrgId;
  }

  async setActiveOrg(input: {
    userId: string;
    orgId: string;
    sessionId?: string;
  }): Promise<UserOrgSummary> {
    const memberships = await this.databaseAdapter.listUserOrganizations(input.userId);
    const membership = memberships.find(
      (record) => record.organization.id === input.orgId,
    );

    if (!membership) {
      throw new TinyClawApiError("Not found", 404);
    }

    if (input.sessionId) {
      await this.databaseAdapter.updateBrowserSessionActiveOrgId(
        input.sessionId,
        membership.organization.id,
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
    requestedOrgId?: string | null,
  ): Promise<AuthUserResponse> {
    const activeOrgId = await this.resolveActiveOrgId(
      user.id,
      sessionId,
      requestedOrgId,
    );

    return {
      email: user.email,
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      activeOrgId,
      orgId: activeOrgId,
    };
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
      throw new TinyClawApiError("Not found", 404);
    }

    const name = input.name.trim();
    const email = normalizeEmail(input.email);
    const phone = input.phone.trim();

    if (!name) {
      throw new TinyClawApiError("Member name is required.", 400);
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new TinyClawApiError("A valid email address is required.", 400);
    }

    if (!phone || !PHONE_PATTERN.test(phone)) {
      throw new TinyClawApiError("A valid phone number is required.", 400);
    }

    if (!ORG_ROLES.includes(input.role)) {
      throw new TinyClawApiError("Invalid org role.", 400);
    }

    const now = new Date().toISOString();
    const existingUser = await this.databaseAdapter.getUserByEmail(email);

    if (existingUser) {
      const member = await this.databaseAdapter.getOrgMember(input.orgId, existingUser.id);
      if (member) {
        throw new TinyClawApiError("User is already a member of this organization.", 409);
      }

      await this.databaseAdapter.upsertOrgMember({
        orgId: input.orgId,
        userId: existingUser.id,
        role: input.role,
        createdAt: now,
      });

      return {
        member: toOrgMemberSummary(existingUser, input.role, now),
        temporaryPassword: null,
      };
    }

    const temporaryPassword = generateTemporaryPassword();
    const user: StoredUserRecord = {
      id: `user_${crypto.randomUUID().replace(/-/g, "")}`,
      email,
      name,
      phone,
      passwordHash: await this.authService.hashPassword(temporaryPassword),
      createdAt: now,
      updatedAt: now,
    };

    await this.databaseAdapter.createUser(user);
    await this.databaseAdapter.upsertOrgMember({
      orgId: input.orgId,
      userId: user.id,
      role: input.role,
      createdAt: now,
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
      throw new TinyClawApiError("Admin name is required.", 400);
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new TinyClawApiError("A valid email address is required.", 400);
    }

    const now = new Date().toISOString();
    const user: StoredUserRecord = {
      id: "user_admin",
      email,
      name,
      phone,
      isPlatformAdmin: true,
      passwordHash: input.admin.passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    await this.databaseAdapter.createUser(user);
    await this.databaseAdapter.upsertOrgMember({
      orgId: organization.id,
      userId: user.id,
      role: "admin",
      createdAt: now,
    });

    return { user, organization };
  }

  async listMembers(orgId: string): Promise<ListOrgMembersResponse> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);
    if (!org) {
      throw new TinyClawApiError("Not found", 404);
    }

    const records = await this.databaseAdapter.listOrgMembers(orgId);
    const members: OrgMemberSummary[] = [];

    for (const record of records) {
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
      throw new TinyClawApiError("Not found", 404);
    }
  }

  async updateMember(
    orgId: string,
    userId: string,
    input: UpdateOrgMemberRequest,
  ): Promise<OrgMemberResponse> {
    const nextRole = input.role;
    if (nextRole !== undefined && !ORG_ROLES.includes(nextRole)) {
      throw new TinyClawApiError("Invalid org role.", 400);
    }

    const member = await this.assertCanChangeAdminMembership(orgId, userId, nextRole);
    const user = await this.databaseAdapter.getUserById(userId);
    if (!user) {
      throw new TinyClawApiError("Not found", 404);
    }

    const now = new Date().toISOString();
    const name = input.name !== undefined ? normalizeOptionalName(input.name) : (user.name ?? null);
    const phone = input.phone !== undefined ? normalizeOptionalPhone(input.phone) : (user.phone ?? null);
    const role = nextRole ?? member.role;

    if (user.name !== name || user.phone !== phone) {
      await this.databaseAdapter.updateUserProfile(
        userId,
        { name, phone },
        now,
      );
    }

    if (member.role !== role) {
      await this.databaseAdapter.upsertOrgMember({
        orgId,
        userId,
        role,
        createdAt: member.createdAt,
      });
    }

    return {
      member: toOrgMemberSummary(
        { ...user, name, phone, updatedAt: now },
        role,
        member.createdAt,
      ),
    };
  }

  async createInvite(input: {
    orgId: string;
    email: string;
    role: OrgRole;
    invitedByUserId: string;
  }): Promise<OrgInviteCreatedResponse> {
    const org = await this.databaseAdapter.getOrganizationById(input.orgId);
    if (!org) {
      throw new TinyClawApiError("Not found", 404);
    }

    const email = normalizeEmail(input.email);
    if (!EMAIL_PATTERN.test(email)) {
      throw new TinyClawApiError("A valid email address is required.", 400);
    }

    if (!ORG_ROLES.includes(input.role)) {
      throw new TinyClawApiError("Invalid org role.", 400);
    }

    const existingUser = await this.databaseAdapter.getUserByEmail(email);
    if (existingUser) {
      const member = await this.databaseAdapter.getOrgMember(input.orgId, existingUser.id);
      if (member) {
        throw new TinyClawApiError("User is already a member of this organization.", 409);
      }
    }

    const pendingInvite = await this.databaseAdapter.getPendingOrgInvite(input.orgId, email);
    if (pendingInvite) {
      throw new TinyClawApiError("An invite is already pending for this email.", 409);
    }

    const now = new Date();
    const token = generateInviteToken();
    const record: StoredOrgInviteRecord = {
      id: `invite_${crypto.randomUUID().replace(/-/g, "")}`,
      orgId: input.orgId,
      email,
      role: input.role,
      tokenHash: this.authService.hashToken(token),
      invitedByUserId: input.invitedByUserId,
      expiresAt: new Date(
        now.getTime() + ORG_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
      acceptedAt: null,
      revokedAt: null,
      createdAt: now.toISOString(),
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
      throw new TinyClawApiError("Invite token is required.", 400);
    }

    const invite = await this.databaseAdapter.getOrgInviteByTokenHash(
      this.authService.hashToken(token),
    );
    if (!invite) {
      throw new TinyClawApiError("Not found", 404);
    }

    assertInviteUsable(invite);

    const password = request.password?.trim();
    if (!password) {
      throw new TinyClawApiError("Password is required to accept an invite.", 400);
    }

    assertNewPassword(password);

    const now = new Date().toISOString();
    let user = await this.databaseAdapter.getUserByEmail(invite.email);

    if (!user) {
      user = {
        id: `user_${crypto.randomUUID().replace(/-/g, "")}`,
        email: invite.email,
        passwordHash: await this.authService.hashPassword(password),
        createdAt: now,
        updatedAt: now,
      };
      await this.databaseAdapter.createUser(user);
    } else {
      const valid = await this.authService.verifyPassword(password, user.passwordHash);
      if (!valid) {
        throw new TinyClawApiError("Invalid credentials", 401);
      }
    }

    const existingMember = await this.databaseAdapter.getOrgMember(invite.orgId, user.id);
    if (existingMember) {
      throw new TinyClawApiError("User is already a member of this organization.", 409);
    }

    await this.databaseAdapter.upsertOrgMember({
      orgId: invite.orgId,
      userId: user.id,
      role: invite.role,
      createdAt: now,
    });
    await this.databaseAdapter.markOrgInviteAccepted(invite.id, now);

    return {
      user,
      orgId: invite.orgId,
      role: invite.role,
    };
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.databaseAdapter.getUserById(input.userId);
    if (!user) {
      throw new TinyClawApiError("Authentication required", 401);
    }

    const currentPassword = input.currentPassword.trim();
    const newPassword = input.newPassword.trim();
    assertNewPassword(newPassword);

    const valid = await this.authService.verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new TinyClawApiError("Current password is incorrect.", 401);
    }

    const now = new Date().toISOString();
    await this.databaseAdapter.updateUserPassword(
      user.id,
      await this.authService.hashPassword(newPassword),
      now,
    );
  }

  private async assertCanChangeAdminMembership(
    orgId: string,
    userId: string,
    nextRole?: OrgRole,
  ): Promise<{ orgId: string; userId: string; role: OrgRole; createdAt: string }> {
    const member = await this.databaseAdapter.getOrgMember(orgId, userId);
    if (!member) {
      throw new TinyClawApiError("Not found", 404);
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
      throw new TinyClawApiError("Cannot change role of the last org admin.", 409);
    }

    if (nextRole === undefined) {
      throw new TinyClawApiError("Cannot remove the last org admin.", 409);
    }

    return member;
  }

  private async insertOrganization(
    request: CreateOrganizationRequest,
  ): Promise<OrganizationSummary> {
    const name = request.name.trim();
    const slug = request.slug.trim().toLowerCase();

    if (!name) {
      throw new TinyClawApiError("Organization name is required.", 400);
    }

    if (!slug || !SLUG_PATTERN.test(slug)) {
      throw new TinyClawApiError(
        "Organization slug must use lowercase letters, numbers, and hyphens.",
        400,
      );
    }

    if (request.admin) {
      if (!request.admin.name.trim() || !request.admin.email.trim()) {
        throw new TinyClawApiError("Admin name and email are required.", 400);
      }
    }

    const existing = await this.databaseAdapter.getOrganizationBySlug(slug);
    if (existing) {
      throw new TinyClawApiError("Organization slug already exists.", 409);
    }

    const now = new Date().toISOString();
    const record: StoredOrganizationRecord = {
      id: `org_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      slug,
      createdAt: now,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertOrganization(record);
    await this.seedOrgProfiles(record.id);
    await ensureLocalClientAccess(this.databaseAdapter);
    return toOrganizationSummary(record);
  }

  private async seedOrgProfiles(orgId: string): Promise<void> {
    const defaultProfile = await seedOrgDefaultProfile(this.databaseAdapter, orgId);
    await initSoulDirectory(getProfileSoulDir(orgId, defaultProfile.id));

    const superBotProfile = await seedOrgSuperBotProfile(this.databaseAdapter, orgId);
    await initSoulDirectory(getProfileSoulDir(orgId, superBotProfile.id));
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalPhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  if (!PHONE_PATTERN.test(trimmed)) {
    throw new TinyClawApiError("Enter a valid phone number.", 400);
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
    throw new TinyClawApiError("Invite has already been accepted.", 400);
  }

  if (invite.revokedAt) {
    throw new TinyClawApiError("Invite is no longer valid.", 400);
  }

  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    throw new TinyClawApiError("Invite has expired.", 400);
  }
}

function assertNewPassword(password: string): void {
  if (password.length < 8) {
    throw new TinyClawApiError("Password must be at least 8 characters.", 400);
  }
}

function toOrganizationSummary(record: StoredOrganizationRecord): OrganizationSummary {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toOrgInviteSummary(record: StoredOrgInviteRecord): OrgInviteSummary {
  return {
    id: record.id,
    orgId: record.orgId,
    email: record.email,
    role: record.role,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

function toOrgMemberSummary(
  user: StoredUserRecord,
  role: OrgRole,
  createdAt: string,
): OrgMemberSummary {
  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email,
    phone: user.phone ?? null,
    role,
    createdAt,
  };
}
