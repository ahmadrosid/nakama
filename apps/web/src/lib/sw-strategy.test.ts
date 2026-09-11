import { describe, expect, test } from "bun:test";
import {
  cacheNameFor,
  classifyRequest,
  shouldCacheResponse,
  staleCacheNames,
} from "./sw-strategy";

const ORIGIN = "https://nakama.example.test";

function classify(
  url: string,
  { method = "GET", mode = "cors" }: { method?: string; mode?: string } = {}
) {
  return classifyRequest({ method, mode, url }, ORIGIN);
}

describe("classifyRequest", () => {
  test("never touches the API, streaming or health routes", () => {
    expect(classify(`${ORIGIN}/v1/sessions`)).toBe("passthrough");
    expect(
      classify(`${ORIGIN}/v1/sessions/abc/messages?stream=true`, {
        method: "POST",
      })
    ).toBe("passthrough");
    expect(classify(`${ORIGIN}/health`)).toBe("passthrough");
    expect(classify(`${ORIGIN}/openapi.json`)).toBe("passthrough");
    expect(classify(`${ORIGIN}/docs`)).toBe("passthrough");
  });

  test("leaves every non-GET request alone", () => {
    expect(
      classify(`${ORIGIN}/chat`, { method: "POST", mode: "navigate" })
    ).toBe("passthrough");
    expect(
      classify(`${ORIGIN}/assets/index-abc123.js`, { method: "HEAD" })
    ).toBe("passthrough");
  });

  test("serves navigations from the network first and the shell offline", () => {
    expect(classify(`${ORIGIN}/chat`, { mode: "navigate" })).toBe("shell");
    expect(classify(`${ORIGIN}/settings`, { mode: "navigate" })).toBe("shell");
    expect(classify(`${ORIGIN}/s/token123`, { mode: "navigate" })).toBe(
      "shell"
    );
  });

  test("treats content-hashed bundles as immutable", () => {
    expect(classify(`${ORIGIN}/assets/index-abc123.js`)).toBe("immutable");
    expect(classify(`${ORIGIN}/assets/index-abc123.css`)).toBe("immutable");
  });

  test("revalidates unhashed static files in the background", () => {
    expect(classify(`${ORIGIN}/manifest.webmanifest`)).toBe("revalidate");
    expect(classify(`${ORIGIN}/nakama-logo-dither.png`)).toBe("revalidate");
    expect(classify(`${ORIGIN}/icons/icon-512.png`)).toBe("revalidate");
  });

  test("does not cache anything from another origin", () => {
    expect(classify("https://cdn.example.test/font.woff2")).toBe("passthrough");
    expect(
      classify("https://cdn.example.test/page", { mode: "navigate" })
    ).toBe("passthrough");
  });

  test("passes through same-origin paths it does not recognise", () => {
    expect(classify(`${ORIGIN}/some/other/thing.bin`)).toBe("passthrough");
  });
});

describe("shouldCacheResponse", () => {
  const base = { redirected: false, status: 200, type: "basic" };

  test("caches a plain same-origin success", () => {
    expect(shouldCacheResponse(base)).toBe(true);
  });

  test("refuses a redirect, which is how an access gate answers", () => {
    expect(shouldCacheResponse({ ...base, redirected: true })).toBe(false);
  });

  test("refuses errors, opaque and partial responses", () => {
    expect(shouldCacheResponse({ ...base, status: 500 })).toBe(false);
    expect(shouldCacheResponse({ ...base, type: "opaque" })).toBe(false);
    expect(shouldCacheResponse({ ...base, status: 206 })).toBe(false);
  });
});

describe("cache names", () => {
  test("scopes the cache to the build version", () => {
    expect(cacheNameFor("abc123")).toBe("nakama-v-abc123");
  });

  test("drops only Nakama caches from other builds", () => {
    expect(
      staleCacheNames(
        ["nakama-v-old", "nakama-v-abc123", "some-other-app-cache"],
        "abc123"
      )
    ).toEqual(["nakama-v-old"]);
  });
});
