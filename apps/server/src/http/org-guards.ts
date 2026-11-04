import { NakamaApiError } from "@nakama/core";
import type { Context } from "hono";
import { getRequestAuth, type RequestAuthContext } from "./shared";
import type { AppEnv } from "./types";

export function requireOrgAdmin(auth: RequestAuthContext): void {
  if (auth.orgRole !== "admin") {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requireOrgMember(auth: RequestAuthContext): void {
  if (auth.orgRole !== "admin" && auth.orgRole !== "member") {
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

export function isOrgAdminOrPlatformAdmin(auth: RequestAuthContext): boolean {
  return auth.orgRole === "admin" || auth.isPlatformAdmin;
}

function requireOrgAdminOrPlatformAdmin(auth: RequestAuthContext): void {
  if (!isOrgAdminOrPlatformAdmin(auth)) {
    throw new NakamaApiError("Forbidden", 403);
  }
}

export function requireOrgAdminOrPlatformAdminFromContext(
  c: Context<AppEnv>
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireOrgAdminOrPlatformAdmin(auth);

  return auth;
}

export function requireOrgMemberFromContext(
  c: Context<AppEnv>
): RequestAuthContext {
  const auth = getRequestAuth(c);
  requireOrgMember(auth);

  return auth;
}

interface ProfileOwnerLookup {
  getProfile(
    orgId: string,
    profileId: string
  ): Promise<{ profile: { isSuper: boolean; ownerUserId?: string | null } }>;
}

/**
 * Platform admins manage every agent, and org admins too when `allowOrgAdmin`
 * is set. Members manage only the agents they created.
 */
export async function requireProfileManageFromContext(
  c: Context<AppEnv>,
  agent: ProfileOwnerLookup,
  options: { allowOrgAdmin?: boolean; profileId?: string } = {}
): Promise<RequestAuthContext> {
  const auth = getRequestAuth(c);

  if (
    auth.isPlatformAdmin ||
    (options.allowOrgAdmin && auth.orgRole === "admin")
  ) {
    return auth;
  }

  requireOrgMember(auth);

  // A missing agent answers 403 too, so members cannot probe which ids exist.
  const found = await agent
    .getProfile(
      requireActiveOrgIdFromContext(c),
      options.profileId ?? decodeURIComponent(c.req.param("profileId") ?? "")
    )
    .catch(() => null);

  if (
    !found ||
    found.profile.isSuper ||
    found.profile.ownerUserId !== auth.user.id
  ) {
    throw new NakamaApiError("Forbidden", 403);
  }

  return auth;
}

/**
 * Null for an agent owner, an org admin or a platform admin, who reach every
 * artifact. Any other org member gets their own user id back and reaches only
 * the artifacts they made (#1816, #2314).
 */
export async function artifactCreatorScopeFromContext(
  c: Context<AppEnv>,
  agent: ProfileOwnerLookup
): Promise<string | null> {
  try {
    await requireProfileManageFromContext(c, agent, { allowOrgAdmin: true });

    return null;
  } catch (error) {
    if (!(error instanceof NakamaApiError && error.status === 403)) {
      throw error;
    }

    const auth = requireOrgMemberFromContext(c);

    // Same answer as the manage guard for a missing agent: no probing ids.
    const found = await agent
      .getProfile(
        requireActiveOrgIdFromContext(c),
        decodeURIComponent(c.req.param("profileId") ?? "")
      )
      .catch(() => null);

    if (!found) {
      throw error;
    }

    return auth.user.id;
  }
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
