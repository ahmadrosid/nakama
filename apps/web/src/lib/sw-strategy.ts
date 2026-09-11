/**
 * Routing rules shared by the service worker and its tests. Kept free of
 * worker globals so `bun test` can exercise it directly.
 */

export type SwStrategy = "immutable" | "passthrough" | "revalidate" | "shell";

/** Mirrors `API_PREFIXES` in `apps/server/src/static-web.ts`. */
const API_PATHS = new Set(["/docs", "/health", "/openapi.json"]);
const API_PREFIXES = ["/v1/", "/docs/"];
/** Vite content-hashes everything under here, so a hit can never be stale. */
const IMMUTABLE_PREFIX = "/assets/";
/** Unhashed but cacheable: icons, logos, fonts, the manifest itself. */
const REVALIDATE_EXTENSIONS = [
  ".css",
  ".ico",
  ".js",
  ".png",
  ".svg",
  ".webmanifest",
];
const CACHE_PREFIX = "nakama-v-";

export function classifyRequest(
  request: { method: string; mode: string; url: string },
  origin: string
): SwStrategy {
  if (request.method !== "GET") {
    return "passthrough";
  }

  const url = new URL(request.url);
  if (url.origin !== origin) {
    return "passthrough";
  }

  const { pathname } = url;
  if (isApiPath(pathname)) {
    return "passthrough";
  }

  // Every client route resolves to the same shell document.
  if (request.mode === "navigate") {
    return "shell";
  }

  if (pathname.startsWith(IMMUTABLE_PREFIX)) {
    return "immutable";
  }

  if (REVALIDATE_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
    return "revalidate";
  }

  return "passthrough";
}

function isApiPath(pathname: string): boolean {
  return (
    API_PATHS.has(pathname) ||
    API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * A Cloudflare Access (or any SSO) gate answers a plain GET with a 200 that
 * carries the login page, flagged as a redirect. Caching that would pin the
 * login page in place of the app, so only clean same-origin 200s are stored.
 */
export function shouldCacheResponse(response: {
  redirected: boolean;
  status: number;
  type: string;
}): boolean {
  if (response.redirected || response.status !== 200) {
    return false;
  }

  return response.type === "basic" || response.type === "default";
}

export function cacheNameFor(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

export function staleCacheNames(names: string[], version: string): string[] {
  const current = cacheNameFor(version);
  return names.filter(
    (name) => name.startsWith(CACHE_PREFIX) && name !== current
  );
}
