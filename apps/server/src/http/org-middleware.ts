import type { OrgRole } from "@nakama/core";
import { ORG_ROLES } from "@nakama/db";
import type { MiddlewareHandler } from "hono";
import type { ServerOptions } from "./context";
import { isPublicRouteRequest } from "./public-routes";
import { errorResponse, type RequestAuthContext } from "./shared";
import type { AppEnv } from "./types";

export const ORG_ID_HEADER = "x-org-id";

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

function resolveOrgId(
  request: Request,
  auth: RequestAuthContext
): string | null {
  const headerOrgId = request.headers.get(ORG_ID_HEADER)?.trim();
  if (headerOrgId) {
    return headerOrgId;
  }

  const sessionOrgId = auth.session?.activeOrgId?.trim();
  return sessionOrgId || null;
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

    let orgId = resolveOrgId(c.req.raw, auth);
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
