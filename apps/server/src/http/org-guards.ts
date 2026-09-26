import { NakamaApiError } from "@nakama/core";
import type { Context } from "hono";
import { getRequestAuth, type RequestAuthContext } from "./shared";
import type { AppEnv } from "./types";

export function requireOrgAdmin(auth: RequestAuthContext): void {
  if (auth.mode === "api-key" || auth.orgRole !== "admin") {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requireNotViewer(auth: RequestAuthContext): void {
  if (!auth.orgRole || auth.orgRole === "viewer") {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requirePlatformAdmin(auth: RequestAuthContext): void {
  if (!auth.isPlatformAdmin) {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requireOrgAdminFromContext(
  c: Context<AppEnv>
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireOrgAdmin(auth);
  return auth;
}

export function requireOrgAdminOrPlatformAdmin(auth: RequestAuthContext): void {
  if (auth.orgRole === "admin" || auth.isPlatformAdmin) {
    return;
  }

  throw new NakamaApiError("Forbidden", 403);
}

export function requireOrgAdminOrPlatformAdminFromContext(
  c: Context<AppEnv>
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireOrgAdminOrPlatformAdmin(auth);
  return auth;
}

export function requireNotViewerFromContext(
  c: Context<AppEnv>
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireNotViewer(auth);
  return auth;
}

export function requirePlatformAdminFromContext(
  c: Context<AppEnv>
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requirePlatformAdmin(auth);
  return auth;
}

export function requireActiveOrgIdFromContext(c: Context<AppEnv>): string {
  const orgId = getRequestAuth(c).activeOrgId?.trim();

  if (!orgId) {
    throw new NakamaApiError("Organization context required", 400);
  }

  return orgId;
}

/**
 * Matches a route's `:orgId` against the caller's active org and 404s on a
 * mismatch, so one org cannot probe another by guessing ids. The decoded form
 * is compared because Hono hands back the raw segment.
 *
 * This is a tenant-isolation boundary, so it lives here rather than being
 * reimplemented per route file: four copies existed and a fix to one would not
 * have reached the others.
 */
export function requireRouteOrgMatchesAuth(
  c: { req: { param: (name: string) => string } },
  authOrgId: string
): string {
  const orgId = decodeURIComponent(c.req.param("orgId"));
  if (authOrgId !== orgId) {
    throw new NakamaApiError("Not found", 404);
  }
  return orgId;
}
