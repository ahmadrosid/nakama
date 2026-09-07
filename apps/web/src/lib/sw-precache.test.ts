import { describe, expect, test } from "bun:test";
import { buildVersion, precacheUrls, type ViteManifest } from "./sw-precache";

const MANIFEST: ViteManifest = {
  "_vendor-js222.js": {
    css: ["assets/vendor-css222.css"],
    file: "assets/vendor-js222.js",
  },
  "index.html": {
    css: ["assets/index-css111.css"],
    file: "assets/index-js111.js",
    imports: ["_vendor-js222.js"],
    isEntry: true,
  },
  "src/pages/SettingsPage.tsx": {
    file: "assets/SettingsPage-js333.js",
  },
};

describe("precacheUrls", () => {
  test("precaches the shell plus the entry chunk and its static imports", () => {
    expect(precacheUrls(MANIFEST, [])).toEqual([
      "/",
      "/assets/index-css111.css",
      "/assets/index-js111.js",
      "/assets/vendor-css222.css",
      "/assets/vendor-js222.js",
    ]);
  });

  test("leaves lazily loaded page chunks to the runtime cache", () => {
    expect(precacheUrls(MANIFEST, [])).not.toContain(
      "/assets/SettingsPage-js333.js"
    );
  });

  test("adds extra urls once, sorted with the rest", () => {
    const urls = precacheUrls(MANIFEST, [
      "/manifest.webmanifest",
      "/assets/index-js111.js",
    ]);
    expect(urls.filter((url) => url === "/assets/index-js111.js")).toHaveLength(
      1
    );
    expect(urls).toContain("/manifest.webmanifest");
  });

  test("survives a cycle between chunks", () => {
    const cyclic: ViteManifest = {
      "b.js": { file: "assets/b.js", imports: ["index.html"] },
      "index.html": {
        file: "assets/a.js",
        imports: ["b.js"],
        isEntry: true,
      },
    };
    expect(precacheUrls(cyclic, [])).toEqual([
      "/",
      "/assets/a.js",
      "/assets/b.js",
    ]);
  });

  test("still precaches the shell when there is no manifest entry", () => {
    expect(precacheUrls({}, ["/manifest.webmanifest"])).toEqual([
      "/",
      "/manifest.webmanifest",
    ]);
  });
});

describe("buildVersion", () => {
  test("changes when the precached build changes", () => {
    expect(buildVersion(["/assets/a.js"])).not.toBe(
      buildVersion(["/assets/b.js"])
    );
  });

  test("is stable for the same build and short enough to read in devtools", () => {
    const version = buildVersion(["/", "/assets/a.js"]);
    expect(version).toBe(buildVersion(["/", "/assets/a.js"]));
    expect(version).toMatch(/^[0-9a-f]{12}$/);
  });
});
