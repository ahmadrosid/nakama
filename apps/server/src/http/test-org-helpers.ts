import type { OrgRole, SetupAuthRequest } from "@tinyclaw/core";
import type { DatabaseAdapter } from "@tinyclaw/db";
import type { AuthService } from "../../services/auth-service";

export const TEST_ORG_ID = "org_test";
export const LOCAL_CLIENT_EMAIL = "local-client@tinyclaw.internal";

export function buildSetupAuthBody(
  email = "admin@example.com",
  overrides: Partial<SetupAuthRequest> = {},
): SetupAuthRequest {
  return {
    organization: {
      name: "Test Org",
      slug: "test-org",
      ...overrides.organization,
    },
    admin: {
      name: "Admin User",
      email,
      phone: "+628123456789",
      password: "password123",
      ...overrides.admin,
    },
  };
}

export async function seedLocalClientUser(adapter: DatabaseAdapter): Promise<void> {
  if (await adapter.getUserByEmail(LOCAL_CLIENT_EMAIL)) {
    return;
  }

  const now = new Date().toISOString();
  await adapter.createUser({
    id: "user_local_client",
    email: LOCAL_CLIENT_EMAIL,
    passwordHash: "unused",
    createdAt: now,
    updatedAt: now,
  });
}

export async function seedOrgForUser(
  adapter: DatabaseAdapter,
  email: string,
  orgId = TEST_ORG_ID,
  role: OrgRole = "admin",
): Promise<string> {
  const user = await adapter.getUserByEmail(email);
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const now = new Date().toISOString();
  await adapter.upsertOrganization({
    id: orgId,
    name: "Test Org",
    slug: "test-org",
    createdAt: now,
    updatedAt: now,
  });
  await adapter.upsertOrgMember({
    orgId,
    userId: user.id,
    role,
    createdAt: now,
  });

  return orgId;
}

export function withOrgId(headers: Record<string, string>, orgId: string): Record<string, string> {
  return { ...headers, "X-Org-Id": orgId };
}

export async function createPlatformAdminUser(
  adapter: DatabaseAdapter,
  authService: AuthService,
  email = "platform@example.com",
  password = "password123",
): Promise<void> {
  const now = new Date().toISOString();
  await adapter.createUser({
    id: `user_${email.replace(/[^a-z0-9]+/gi, "_")}`,
    email,
    passwordHash: await authService.hashPassword(password),
    isPlatformAdmin: true,
    createdAt: now,
    updatedAt: now,
  });
}
