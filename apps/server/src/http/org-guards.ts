import type { Context } from "hono";
import { TinyClawApiError } from "@tinyclaw/core";
import type { AppEnv } from "./types";
import { getRequestAuth, type RequestAuthContext } from "./shared";

export function requireOrgAdmin(auth: RequestAuthContext): void {
  if (auth.orgRole !== "admin") {
    throw new TinyClawApiError("Forbidden", 403);
  }
}

export function requireNotViewer(auth: RequestAuthContext): void {
  if (auth.orgRole === "viewer") {
    throw new TinyClawApiError("Forbidden", 403);
  }
}

export function requirePlatformAdmin(auth: RequestAuthContext): void {
  if (!auth.isPlatformAdmin) {
    throw new TinyClawApiError("Forbidden", 403);
  }
}

export function requireOrgAdminFromContext(c: Context<AppEnv>): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireOrgAdmin(auth);
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
