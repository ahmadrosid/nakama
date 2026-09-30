import type { MiddlewareHandler } from "hono";
import type { ServerOptions } from "./context";
import { isPublicRouteRequest } from "./public-routes";
import {
  assertBrowserCsrf,
  authenticateRequest,
  errorResponse,
  isPendingBrowserMfa,
  isPendingMfaAllowedRequest,
} from "./shared";
import type { AppEnv } from "./types";

export function createAuthMiddleware(
  options: ServerOptions
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { authService, databaseAdapter } = options;

    if (!authService || isPublicRouteRequest(c.req.method, c.req.path)) {
      await next();
      return;
    }

    if (!databaseAdapter) {
      c.res = Response.json(
        { error: "Authentication not configured" },
        { status: 500 }
      );
      return;
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    if (!auth) {
      c.res = Response.json(
        { error: "Authentication required" },
        { status: 401 }
      );
      return;
    }

    try {
      assertBrowserCsrf(c.req.raw, auth, authService);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        "status" in error
      ) {
        c.res = Response.json(
          { error: String(error.message) },
          { status: Number(error.status) }
        );
        return;
      }

      throw error;
    }

    if (
      (await isPendingBrowserMfa(auth, databaseAdapter)) &&
      !isPendingMfaAllowedRequest(c.req.method, c.req.path)
    ) {
      c.res = errorResponse(
        "Complete MFA enrollment before accessing this resource.",
        403
      );
      return;
    }

    c.set("auth", auth);
    await next();
  };
}
