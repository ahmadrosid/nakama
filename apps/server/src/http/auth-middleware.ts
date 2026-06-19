import type { MiddlewareHandler } from "hono";
import type { ServerOptions } from "./context";
import {
  assertBrowserCsrf,
  authenticateRequest,
} from "./shared";
import { isPublicRouteRequest } from "./public-routes";

export function createAuthMiddleware(options: ServerOptions): MiddlewareHandler {
  return async (c, next) => {
    const { authService, databaseAdapter } = options;

    if (!authService || isPublicRouteRequest(c.req.method, c.req.path)) {
      await next();
      return;
    }

    if (!databaseAdapter) {
      c.res = Response.json({ error: "Authentication not configured" }, { status: 500 });
      return;
    }

    const auth = await authenticateRequest(c.req.raw, authService, databaseAdapter);
    if (!auth) {
      c.res = Response.json({ error: "Authentication required" }, { status: 401 });
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
          { status: Number(error.status) },
        );
        return;
      }

      throw error;
    }

    await next();
  };
}
