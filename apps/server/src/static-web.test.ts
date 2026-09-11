import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryServeStaticWeb } from "./static-web";

function createDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), "nakama-static-web-"));
  mkdirSync(join(distDir, "assets"));
  writeFileSync(join(distDir, "index.html"), "<!doctype html>");
  writeFileSync(join(distDir, "manifest.webmanifest"), '{"name":"Nakama"}');
  writeFileSync(
    join(distDir, "sw.js"),
    "self.addEventListener('install', () => {});"
  );
  writeFileSync(join(distDir, "assets", "index-abc123.js"), "export {};");
  writeFileSync(join(distDir, "icon-192.png"), "png");
  return distDir;
}

function serve(distDir: string, pathname: string): Response {
  const response = tryServeStaticWeb(
    new Request(`http://localhost:4310${pathname}`),
    distDir
  );
  if (!response) {
    throw new Error(`no static response for ${pathname}`);
  }
  return response;
}

describe("tryServeStaticWeb", () => {
  test("serves the web app manifest as application/manifest+json", () => {
    const distDir = createDist();
    const response = serve(distDir, "/manifest.webmanifest");
    expect(response.headers.get("Content-Type")).toBe(
      "application/manifest+json; charset=utf-8"
    );
  });

  test("keeps the service worker revalidated instead of browser-cached", () => {
    const distDir = createDist();
    const response = serve(distDir, "/sw.js");
    expect(response.headers.get("Content-Type")).toBe(
      "text/javascript; charset=utf-8"
    );
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  test("keeps the app shell revalidated so a new build is picked up", () => {
    const distDir = createDist();
    expect(serve(distDir, "/").headers.get("Cache-Control")).toBe("no-cache");
    expect(serve(distDir, "/index.html").headers.get("Cache-Control")).toBe(
      "no-cache"
    );
    // SPA fallback for a client route.
    expect(serve(distDir, "/chat").headers.get("Cache-Control")).toBe(
      "no-cache"
    );
  });

  test("lets content-hashed assets be cached immutably", () => {
    const distDir = createDist();
    const response = serve(distDir, "/assets/index-abc123.js");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  test("revalidates the manifest but caches unhashed icons for a day", () => {
    const distDir = createDist();
    expect(
      serve(distDir, "/manifest.webmanifest").headers.get("Cache-Control")
    ).toBe("no-cache");
    expect(serve(distDir, "/icon-192.png").headers.get("Cache-Control")).toBe(
      "public, max-age=86400"
    );
  });

  test("still answers HEAD with the same headers and no body", async () => {
    const distDir = createDist();
    const response = tryServeStaticWeb(
      new Request("http://localhost:4310/manifest.webmanifest", {
        method: "HEAD",
      }),
      distDir
    );
    expect(response?.headers.get("Content-Type")).toBe(
      "application/manifest+json; charset=utf-8"
    );
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response?.text()).toBe("");
  });
});
