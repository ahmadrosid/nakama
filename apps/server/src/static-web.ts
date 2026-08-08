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
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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
        return fileResponse(indexPath, request.method);
      }
    }

    return null;
  }

  return fileResponse(filePath, request.method);
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

function fileResponse(filePath: string, method: string): Response {
  const file = Bun.file(filePath);
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[extension] ?? file.type;

  if (method === "HEAD") {
    return new Response(null, {
      headers: { "Content-Type": contentType },
    });
  }

  return new Response(file, {
    headers: { "Content-Type": contentType },
  });
}
