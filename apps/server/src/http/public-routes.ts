export const PUBLIC_ROUTES = new Set([
  "/health",
  "/docs",
  "/docs/",
  "/openapi.json",
  "/v1/auth/setup",
  "/v1/auth/setup/import/preview",
  "/v1/auth/setup/import/restore",
  "/v1/auth/login",
  "/v1/auth/me",
  "/v1/auth/accept-invite",
  "/v1/composio/oauth/callback",
]);

export function isPublicRouteRequest(
  method: string,
  pathname: string
): boolean {
  if (pathname === "/v1/auth/me") {
    return method === "GET";
  }

  return (
    PUBLIC_ROUTES.has(pathname) ||
    /^\/v1\/notify\/[^/]+$/.test(pathname) ||
    // OAuth provider redirect: it carries a single-use code and state, and the
    // browser arriving here has no Nakama session.
    (method === "GET" &&
      /^\/v1\/mcp\/oauth\/callback\/[^/]+$/.test(pathname)) ||
    (method === "GET" &&
      /^\/v1\/public\/artifact-shares\/[^/]+$/.test(pathname))
  );
}
