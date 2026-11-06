import { NakamaApiError, type ProfileResponse } from "@nakama/core";
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

/**
 * The profile detail a caller may see. MCP servers are admin resources, so
 * their raw provider errors go only to admins. A member who does not own the
 * agent also gets no system prompt, the same rule the soul routes use.
 */
export function profileResponseFor(
  c: Context<AppEnv>,
  response: ProfileResponse,
  options: { ownsProfile: boolean } = { ownsProfile: true }
): ProfileResponse {
  const auth = getRequestAuth(c);

  if (auth.isPlatformAdmin || auth.orgRole === "admin") {
    return response;
  }

  return {
    profile: {
      ...response.profile,
      mcpServers: response.profile.mcpServers.map((server) => ({
        ...server,
        lastError: null,
      })),
      systemPrompt: options.ownsProfile ? response.profile.systemPrompt : "",
    },
  };
}

interface ProfileOwnerLookup {
  getProfileAccess(
    orgId: string,
    profileId: string
  ): Promise<{ isSuper: boolean; ownerUserId: string | null } | null>;
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
  // A failed lookup is not a missing agent: it throws, so it is not a 403.
  const found = await agent.getProfileAccess(
    requireActiveOrgIdFromContext(c),
    options.profileId ?? decodeURIComponent(c.req.param("profileId") ?? "")
  );

  if (!found || found.isSuper || found.ownerUserId !== auth.user.id) {
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
  const auth = getRequestAuth(c);

  if (auth.isPlatformAdmin || auth.orgRole === "admin") {
    return null;
  }

  requireOrgMember(auth);

  // Same answer as the manage guard for a missing agent: no probing ids.
  const found = await agent.getProfileAccess(
    requireActiveOrgIdFromContext(c),
    decodeURIComponent(c.req.param("profileId") ?? "")
  );

  if (!found) {
    throw new NakamaApiError("Forbidden", 403);
  }

  return !found.isSuper && found.ownerUserId === auth.user.id
    ? null
    : auth.user.id;
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
