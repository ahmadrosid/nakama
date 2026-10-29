import { describe, expect, test } from "bun:test";
import { precacheUrls, type ViteManifest } from "./sw-precache";

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
  test("precaches the shell, the entry chunk and its static imports, nothing lazy", () => {
    expect(precacheUrls(MANIFEST, [])).toEqual([
      "/",
      "/assets/index-css111.css",
      "/assets/index-js111.js",
      "/assets/vendor-css222.css",
      "/assets/vendor-js222.js",
    ]);
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

describe("buildVersion", () => {});
