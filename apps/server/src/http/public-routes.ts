const PUBLIC_ROUTES = new Set([
  "/health",
  "/artifact-frame",
  "/docs",
  "/docs/",
  "/openapi.json",
  "/v1/auth/setup",
  "/v1/auth/setup/import/preview",
  "/v1/auth/setup/import/restore",
  "/v1/auth/login",
  "/v1/auth/passkey/login/options",
  "/v1/auth/me",
  "/v1/auth/accept-invite",
  "/v1/auth/password-reset/request",
  "/v1/auth/password-reset/complete",
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
    // The stdio bridge an ACP agent starts has no login. The token in the path
    // is the credential, and it reaches only that chat's Nakama tools.
    (method === "POST" && /^\/v1\/acp-mcp\/[^/]+$/.test(pathname)) ||
    // OAuth provider redirect: it carries a single-use code and state, and the
    // browser arriving here has no Nakama session.
    (method === "GET" &&
      /^\/v1\/mcp\/oauth\/callback\/[^/]+$/.test(pathname)) ||
    // The Meet extension pairs without a login, then sends its Meet key; the
    // route itself checks that key and accepts no other credential.
    (method === "POST" &&
      /^\/v1\/meet\/extension\/(?:pair|start|leave|disconnect)$/.test(
        pathname
      )) ||
    (method === "GET" &&
      /^\/v1\/meet\/extension\/(?:pair\/[^/]+|status|transcript)$/.test(
        pathname
      )) ||
    // The capture socket sends a one-time ticket as its first message.
    (method === "GET" && pathname === "/v1/meet/capture") ||
    (method === "GET" &&
      /^\/v1\/public\/artifact-shares\/[^/]+$/.test(pathname)) ||
    // Microsoft posts Teams activities with its own service token; the worker's
    // SDK verifies it. Only this method and path skip Nakama authentication.
    (method === "POST" &&
      /^\/v1\/channels\/teams\/[^/]+\/messages$/.test(pathname))
  );
}
