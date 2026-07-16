export const PUBLIC_ROUTES = new Set([
  "/health",
  "/docs",
  "/docs/",
  "/openapi.json",
  "/v1/auth/setup",
  "/v1/auth/login",
  "/v1/auth/me",
  "/v1/auth/accept-invite",
  "/v1/composio/oauth/callback",
  "/v1/tasks/__capability_probe__/messages",
  "/v1/tools",
]);

export function isPublicRouteRequest(method: string, pathname: string): boolean {
  return (
    PUBLIC_ROUTES.has(pathname) ||
    /^\/v1\/notify\/[^/]+$/.test(pathname) ||
    (method === "GET" && /^\/v1\/profiles\/[^/]+\/avatar$/.test(pathname)) ||
    (method === "GET" && /^\/v1\/public\/artifact-shares\/[^/]+$/.test(pathname))
  );
}
