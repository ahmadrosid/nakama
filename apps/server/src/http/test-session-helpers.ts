import { expect } from "bun:test";
import type { OrgRole } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import {
  buildSetupAuthBody,
  createPlatformAdminUser,
  withOrgId,
} from "./test-org-helpers";

export type AppFetch = { fetch: typeof fetch };

export function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return (
    headers.getSetCookie?.() ??
    (response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie")!]
      : [])
  );
}

export function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Missing cookie: ${name}`);
  }

  return cookie.split(";")[0]!.split("=", 2)[1]!;
}

export function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return [
    `nakama_session=${cookieValue(setCookies, "nakama_session")}`,
    `nakama_csrf=${cookieValue(setCookies, "nakama_csrf")}`,
  ].join("; ");
}

export type TestBrowserSession = {
  response: Response;
  setCookies: string[];
  cookieHeader: string;
  csrfToken: string;
  orgId?: string;
  headers(
    extra?: Record<string, string>,
    orgIdOverride?: string
  ): Record<string, string>;
};

export function browserSessionFromResponse(
  response: Response,
  orgId?: string
): TestBrowserSession {
  const setCookies = extractSetCookies(response);
  const cookieHeader = cookieHeaderFromSetCookies(setCookies);
  const csrfToken = cookieValue(setCookies, "nakama_csrf");

  return {
    cookieHeader,
    csrfToken,
    headers(extra = {}, orgIdOverride?: string) {
      const base = { Cookie: cookieHeader, ...extra };
      const resolvedOrgId = orgIdOverride ?? orgId;
      return resolvedOrgId ? withOrgId(base, resolvedOrgId) : base;
    },
    orgId,
    response,
    setCookies,
  };
}

export async function setupFreshInstallSession(
  app: AppFetch,
  databaseAdapter: DatabaseAdapter,
  email = "admin@example.com",
  role: OrgRole = "admin"
): Promise<TestBrowserSession> {
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/setup", {
      body: JSON.stringify(buildSetupAuthBody(email)),
      method: "POST",
    })
  );

  if (response.status !== 201) {
    throw new Error(`Failed to create browser session: ${response.status}`);
  }

  const setupBody = (await response.json()) as { activeOrgId: string };
  const orgId = setupBody.activeOrgId;

  if (role !== "admin") {
    const user = await databaseAdapter.getUserByEmail(email);
    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId,
      role,
      userId: user.id,
    });
  }

  return browserSessionFromResponse(response, orgId);
}

export async function loginPlatformAdminSession(
  app: AppFetch,
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  email = "platform@example.com",
  password = "password123"
): Promise<TestBrowserSession> {
  await createPlatformAdminUser(databaseAdapter, authService, email, password);

  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  return browserSessionFromResponse(response);
}

export async function loginUserSession(
  app: AppFetch,
  email: string,
  password: string,
  orgId?: string
): Promise<TestBrowserSession> {
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  return browserSessionFromResponse(response, orgId);
}

export type SeedOrgAdminOptions = {
  authService?: AuthService;
  email?: string;
  orgId?: string;
  password?: string;
  /** When set, also upserts a default profile with this id. */
  profileId?: string;
  userId?: string;
};

export async function seedOrgAdmin(
  databaseAdapter: DatabaseAdapter,
  opts: SeedOrgAdminOptions = {}
) {
  const email = opts.email ?? "admin@example.com";
  const password = opts.password ?? "password123";
  const orgId = opts.orgId ?? "org_test";
  const userId = opts.userId ?? "user_admin";
  const authService = opts.authService ?? new AuthService();
  const now = new Date().toISOString();

  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id: userId,
    passwordHash: await authService.hashPassword(password),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: orgId,
    name: "Test Org",
    slug: orgId,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId,
    role: "admin",
    userId,
  });

  if (opts.profileId) {
    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: opts.profileId,
      isSuper: false,
      model: "openrouter/auto",
      name: "Default",
      orgId,
      systemPrompt: "You are helpful.",
      updatedAt: now,
    });
  }

  return {
    email,
    orgId,
    password,
    profileId: opts.profileId,
    userId,
  };
}
