import type { OrgRole } from "@nakama/core";
import { ORG_ROLES } from "@nakama/db";
import type { MiddlewareHandler } from "hono";
import type { ServerOptions } from "./context";
import { isPublicRouteRequest } from "./public-routes";
import { errorResponse, type RequestAuthContext } from "./shared";
import type { AppEnv } from "./types";

export const ORG_ID_HEADER = "x-org-id";
const PLUGIN_UI_PATH = /^\/v1\/plugins\/ui\/([^/]+)(?:\/|$)/;

function isPlatformRoute(pathname: string): boolean {
  return pathname === "/v1/platform" || pathname.startsWith("/v1/platform/");
}

function isAuthRoute(pathname: string): boolean {
  return pathname === "/v1/auth" || pathname.startsWith("/v1/auth/");
}

function assertOrgRole(role: string): asserts role is OrgRole {
  if (!(ORG_ROLES as readonly string[]).includes(role)) {
    throw new Error(`Invalid organization role: ${role}`);
  }
}

function pluginUiPathOrgId(pathname: string): string | null {
  const match = pathname.match(PLUGIN_UI_PATH);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function resolveOrgId(
  request: Request,
  auth: RequestAuthContext,
  pathname: string
): { conflict: true } | { orgId: string | null } {
  const headerOrgId = request.headers.get(ORG_ID_HEADER)?.trim() || null;
  const pathOrgId = pluginUiPathOrgId(pathname);

  if (headerOrgId && pathOrgId && headerOrgId !== pathOrgId) {
    return { conflict: true };
  }

  if (headerOrgId) {
    return { orgId: headerOrgId };
  }
  if (pathOrgId) {
    return { orgId: pathOrgId };
  }

  const sessionOrgId = auth.session?.activeOrgId?.trim();
  return { orgId: sessionOrgId || null };
}

export function createOrgContextMiddleware(
  options: ServerOptions
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { databaseAdapter } = options;

    if (isPublicRouteRequest(c.req.method, c.req.path)) {
      await next();
      return;
    }

    const auth = c.get("auth");
    if (!auth) {
      await next();
      return;
    }

    if (!databaseAdapter) {
      c.res = errorResponse("Authentication not configured", 500);
      return;
    }

    if (isPlatformRoute(c.req.path) || isAuthRoute(c.req.path)) {
      await next();
      return;
    }

    const resolved = resolveOrgId(c.req.raw, auth, c.req.path);
    if ("conflict" in resolved) {
      c.res = errorResponse("Organization context conflict", 400);
      return;
    }

    let orgId = resolved.orgId;
    if (!orgId && auth.mode === "local-token") {
      const memberships = await databaseAdapter.listUserOrganizations(
        auth.user.id
      );
      orgId = memberships[0]?.organization.id ?? null;
    }
    if (!orgId) {
      c.res = errorResponse("Organization context required", 400);
      return;
    }

    const organization = await databaseAdapter.getOrganizationById(orgId);
    if (!organization || organization.archivedAt) {
      c.res = errorResponse("Not found", 404);
      return;
    }

    const member = await databaseAdapter.getOrgMember(orgId, auth.user.id);
    if (!member) {
      c.res = errorResponse("Not found", 404);
      return;
    }

    assertOrgRole(member.role);

    c.set("auth", {
      ...auth,
      activeOrgId: orgId,
      orgRole: member.role,
    });

    await next();
  };
}
