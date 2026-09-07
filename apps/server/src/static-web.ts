import { existsSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const API_PREFIXES = ["/v1/", "/health", "/docs", "/openapi.json"] as const;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Vite writes content-hashed filenames here, so they can never go stale. */
const IMMUTABLE_PREFIX = "/assets/";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/**
 * The shell, the service worker and the manifest decide which build a client
 * runs, so they must be revalidated. Everything else is unhashed but stable
 * (icons, logos), and a day of caching is safe for it.
 */
const REVALIDATE_EXTENSIONS = new Set([".html", ".webmanifest"]);
const REVALIDATE_CACHE_CONTROL = "no-cache";
const DEFAULT_CACHE_CONTROL = "public, max-age=86400";

export function resolveWebDistDir(projectRoot: string): string | null {
  const distDir = join(projectRoot, "apps/web/dist");
  return existsSync(distDir) ? distDir : null;
}

export function tryServeStaticWeb(
  request: Request,
  distDir: string
): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (isApiPath(pathname)) {
    return null;
  }

  const relativePath =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolveDistFile(distDir, relativePath);

  if (!filePath) {
    if (!pathname.includes(".")) {
      const indexPath = resolveDistFile(distDir, "index.html");
      if (indexPath) {
        return fileResponse(indexPath, request.method, pathname);
      }
    }

    return null;
  }

  return fileResponse(filePath, request.method, pathname);
}

function isApiPath(pathname: string): boolean {
  if (pathname === "/health") {
    return true;
  }

  return API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

function resolveDistFile(distDir: string, relativePath: string): string | null {
  const normalized = normalize(relativePath);

  if (normalized.startsWith("..") || normalized.includes(`..${sep}`)) {
    return null;
  }

  const filePath = join(distDir, normalized);

  if (!filePath.startsWith(distDir)) {
    return null;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  return filePath;
}

function cacheControlFor(pathname: string, extension: string): string {
  if (pathname.startsWith(IMMUTABLE_PREFIX)) {
    return IMMUTABLE_CACHE_CONTROL;
  }

  if (pathname === "/sw.js" || REVALIDATE_EXTENSIONS.has(extension)) {
    return REVALIDATE_CACHE_CONTROL;
  }

  return DEFAULT_CACHE_CONTROL;
}

function fileResponse(
  filePath: string,
  method: string,
  pathname: string
): Response {
  const file = Bun.file(filePath);
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[extension] ?? file.type;
  const headers = {
    "Cache-Control": cacheControlFor(pathname, extension),
    "Content-Type": contentType,
  };

  if (method === "HEAD") {
    return new Response(null, { headers });
  }

  return new Response(file, { headers });
}
