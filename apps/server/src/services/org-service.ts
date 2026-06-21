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
} from "@tinyclaw/core/contract";
import { ORG_INVITE_EXPIRY_DAYS, ORG_ROLES } from "@tinyclaw/db";
import type {
  DatabaseAdapter,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
  StoredUserRecord,
} from "@tinyclaw/db";
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

  async createOrganization(request: CreateOrganizationRequest): Promise<CreateOrganizationResponse> {
    const organization = await this.insertOrganization(request);

    if (!request.admin) {
      return { organization };
    }

    const adminMember = await this.addMember({
      orgId: organization.id,
      name: request.admin.name,
      email: request.admin.email,
      phone: request.admin.phone,
      role: "admin",
    });

    return { organization, adminMember };
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
    const phone = input.admin.phone.trim();

    if (!name) {
      throw new TinyClawApiError("Admin name is required.", 400);
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new TinyClawApiError("A valid email address is required.", 400);
    }

    if (!phone || !PHONE_PATTERN.test(phone)) {
      throw new TinyClawApiError("A valid phone number is required.", 400);
    }

    const now = new Date().toISOString();
    const user: StoredUserRecord = {
      id: "user_admin",
      email,
      name,
      phone,
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

  async updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<OrgMemberResponse> {
    if (!ORG_ROLES.includes(role)) {
      throw new TinyClawApiError("Invalid org role.", 400);
    }

    const member = await this.assertCanChangeAdminMembership(orgId, userId, role);
    const user = await this.databaseAdapter.getUserById(userId);
    if (!user) {
      throw new TinyClawApiError("Not found", 404);
    }

    if (member.role !== role) {
      await this.databaseAdapter.upsertOrgMember({
        orgId,
        userId,
        role,
        createdAt: member.createdAt,
      });
    }

    return { member: toOrgMemberSummary(user, role, member.createdAt) };
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
      if (!request.admin.name.trim() || !request.admin.email.trim() || !request.admin.phone.trim()) {
        throw new TinyClawApiError("Admin name, email, and phone are required.", 400);
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
    return toOrganizationSummary(record);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
