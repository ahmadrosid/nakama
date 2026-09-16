import { describe, expect, test } from "bun:test";
import { updateManifest } from "./publish-release.mjs";

describe("desktop release metadata", () => {
  const manifest = {
    files: [
      { sha512: "checksum", size: 42, url: "Nakama-0.2.0-arm64-mac.zip" },
    ],
    path: "Nakama-0.2.0-arm64-mac.zip",
    sha512: "checksum",
    version: "0.2.0",
  };
  test("pins downloads to immutable version assets while preserving integrity fields", () => {
    const output = updateManifest(manifest, "desktop-v0.2.0");
    expect(output.files[0]).toEqual({
      sha512: "checksum",
      size: 42,
      url: "https://github.com/ahmadrosid/nakama/releases/download/desktop-v0.2.0/Nakama-0.2.0-arm64-mac.zip",
    });
    expect(output.path).toBe(output.files[0].url);
    expect(output.sha512).toBe("checksum");
    expect(manifest.files[0].url).toBe("Nakama-0.2.0-arm64-mac.zip");
  });
  test("preserves DMG entries alongside the required ZIP", () => {
    const files = [
      ...manifest.files,
      { sha512: "dmg-checksum", url: "Nakama-0.2.0-arm64.dmg" },
    ];
    expect(
      updateManifest({ ...manifest, files }, "desktop-v0.2.0").files[1]
    ).toEqual({
      sha512: "dmg-checksum",
      url: "https://github.com/ahmadrosid/nakama/releases/download/desktop-v0.2.0/Nakama-0.2.0-arm64.dmg",
    });
    expect(() =>
      updateManifest({ ...manifest, files: files.slice(1) }, "desktop-v0.2.0")
    ).toThrow();
  });
  test("rejects mismatched versions and unexpected download paths", () => {
    expect(() => updateManifest(manifest, "desktop-v0.3.0")).toThrow();
    expect(() =>
      updateManifest({ ...manifest, files: [] }, "desktop-v0.2.0")
    ).toThrow();
    expect(() =>
      updateManifest({ ...manifest, path: "../payload.zip" }, "desktop-v0.2.0")
    ).toThrow();
    expect(() =>
      updateManifest(
        { ...manifest, version: "0.2.0-beta.1" },
        "desktop-v0.2.0-beta.1"
      )
    ).toThrow();
  });
});
