import type { OrgRole, SetupAuthRequest } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "../../services/auth-service";

export const TEST_ORG_ID = "org_test";
export const LOCAL_CLIENT_EMAIL = "local-client@nakama.internal";

export function buildSetupAuthBody(
  email = "admin@example.com",
  overrides: Partial<SetupAuthRequest> = {}
): SetupAuthRequest {
  return {
    admin: {
      email,
      name: "Admin User",
      password: "password123",
      phone: "+628123456789",
      ...overrides.admin,
    },
    organization: {
      name: "Test Org",
      slug: "test-org",
      ...overrides.organization,
    },
  };
}

export async function seedLocalClientUser(
  adapter: DatabaseAdapter
): Promise<void> {
  if (await adapter.getUserByEmail(LOCAL_CLIENT_EMAIL)) {
    return;
  }

  const now = new Date().toISOString();
  await adapter.createUser({
    createdAt: now,
    email: LOCAL_CLIENT_EMAIL,
    id: "user_local_client",
    passwordHash: "unused",
    updatedAt: now,
  });
}

export async function seedOrgForUser(
  adapter: DatabaseAdapter,
  email: string,
  orgId = TEST_ORG_ID,
  role: OrgRole = "admin"
): Promise<string> {
  const user = await adapter.getUserByEmail(email);
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const now = new Date().toISOString();
  const existing =
    (await adapter.getOrganizationById(orgId)) ??
    (await adapter.getOrganizationBySlug("test-org"));
  const resolvedOrgId = existing?.id ?? orgId;

  if (!existing) {
    await adapter.upsertOrganization({
      createdAt: now,
      id: resolvedOrgId,
      name: "Test Org",
      slug: "test-org",
      updatedAt: now,
    });
  }

  await adapter.upsertOrgMember({
    createdAt: now,
    orgId: resolvedOrgId,
    role,
    userId: user.id,
  });

  return resolvedOrgId;
}

export function withOrgId(
  headers: Record<string, string>,
  orgId: string
): Record<string, string> {
  return { ...headers, "X-Org-Id": orgId };
}

export async function createPlatformAdminUser(
  adapter: DatabaseAdapter,
  authService: AuthService,
  email = "platform@example.com",
  password = "password123"
): Promise<void> {
  const now = new Date().toISOString();
  await adapter.createUser({
    createdAt: now,
    email,
    id: `user_${email.replace(/[^a-z0-9]+/gi, "_")}`,
    isPlatformAdmin: true,
    passwordHash: await authService.hashPassword(password),
    updatedAt: now,
  });
}
