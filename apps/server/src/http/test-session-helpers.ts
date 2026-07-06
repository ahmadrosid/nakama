import { expect } from "bun:test";
import type { OrgRole } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "../services/auth-service";
import { buildSetupAuthBody, createPlatformAdminUser, withOrgId } from "./test-org-helpers";

export type AppFetch = { fetch: typeof fetch };

export function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
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
  headers(extra?: Record<string, string>, orgIdOverride?: string): Record<string, string>;
};

export function browserSessionFromResponse(response: Response, orgId?: string): TestBrowserSession {
  const setCookies = extractSetCookies(response);
  const cookieHeader = cookieHeaderFromSetCookies(setCookies);
  const csrfToken = cookieValue(setCookies, "nakama_csrf");

  return {
    response,
    setCookies,
    cookieHeader,
    csrfToken,
    orgId,
    headers(extra = {}, orgIdOverride?: string) {
      const base = { Cookie: cookieHeader, ...extra };
      const resolvedOrgId = orgIdOverride ?? orgId;
      return resolvedOrgId ? withOrgId(base, resolvedOrgId) : base;
    },
  };
}

export async function setupFreshInstallSession(
  app: AppFetch,
  databaseAdapter: DatabaseAdapter,
  email = "admin@example.com",
  role: OrgRole = "admin",
): Promise<TestBrowserSession> {
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify(buildSetupAuthBody(email)),
    }),
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
      orgId,
      userId: user.id,
      role,
      createdAt: new Date().toISOString(),
    });
  }

  return browserSessionFromResponse(response, orgId);
}

export async function loginPlatformAdminSession(
  app: AppFetch,
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  email = "platform@example.com",
  password = "password123",
): Promise<TestBrowserSession> {
  await createPlatformAdminUser(databaseAdapter, authService, email, password);

  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );

  expect(response.status).toBe(200);
  return browserSessionFromResponse(response);
}

export async function loginUserSession(
  app: AppFetch,
  email: string,
  password: string,
  orgId?: string,
): Promise<TestBrowserSession> {
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );

  expect(response.status).toBe(200);
  return browserSessionFromResponse(response, orgId);
}
