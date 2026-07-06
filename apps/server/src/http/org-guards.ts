import type { Context } from "hono";
import { NakamaApiError } from "@nakama/core";
import type { AppEnv } from "./types";
import { getRequestAuth, type RequestAuthContext } from "./shared";

export function requireOrgAdmin(auth: RequestAuthContext): void {
  if (auth.orgRole !== "admin") {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requireNotViewer(auth: RequestAuthContext): void {
  if (auth.orgRole === "viewer") {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requirePlatformAdmin(auth: RequestAuthContext): void {
  if (!auth.isPlatformAdmin) {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requireOrgAdminFromContext(c: Context<AppEnv>): RequestAuthContext {
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
  c: Context<AppEnv>,
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireOrgAdminOrPlatformAdmin(auth);
  return auth;
}

export function requireNotViewerFromContext(c: Context<AppEnv>): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireNotViewer(auth);
  return auth;
}

export function requirePlatformAdminFromContext(c: Context<AppEnv>): RequestAuthContext {
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
