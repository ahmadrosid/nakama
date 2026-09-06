import { describe, expect, test } from "bun:test";
import {
  buildPublicArtifactShareUrl,
  resolvePublicArtifactShareOrigin,
} from "./public-artifact-share-url";

describe("resolvePublicArtifactShareOrigin", () => {
  test("allows empty baseUrl for same-origin relative fetches", () => {
    expect(resolvePublicArtifactShareOrigin("")).toBe("");
    expect(resolvePublicArtifactShareOrigin("  ")).toBe("");
  });

  test("allows http(s) absolute origins", () => {
    expect(resolvePublicArtifactShareOrigin("https://app.example.com/")).toBe(
      "https://app.example.com"
    );
    expect(resolvePublicArtifactShareOrigin("http://app.example.com")).toBe(
      "http://app.example.com"
    );
  });

  test("rejects non-http protocols", () => {
    expect(() =>
      resolvePublicArtifactShareOrigin("file:///etc/passwd")
    ).toThrow("unavailable");
    expect(() =>
      resolvePublicArtifactShareOrigin("javascript:alert(1)")
    ).toThrow("unavailable");
  });

  test("rejects invalid URLs", () => {
    expect(() => resolvePublicArtifactShareOrigin("not a url")).toThrow(
      "unavailable"
    );
  });

  test("rejects localhost in production", () => {
    expect(() =>
      resolvePublicArtifactShareOrigin("http://localhost:4310", {
        isProd: true,
      })
    ).toThrow("unavailable");
    expect(() =>
      resolvePublicArtifactShareOrigin("http://127.0.0.1:4310", {
        isProd: true,
      })
    ).toThrow("unavailable");
  });

  test("allows localhost outside production", () => {
    expect(
      resolvePublicArtifactShareOrigin("http://localhost:4310", {
        isProd: false,
      })
    ).toBe("http://localhost:4310");
  });
});

describe("buildPublicArtifactShareUrl", () => {
  test("builds relative and absolute share URLs", () => {
    expect(buildPublicArtifactShareUrl("", "tok_1", "meta=1")).toBe(
      "/v1/public/artifact-shares/tok_1?meta=1"
    );
    expect(
      buildPublicArtifactShareUrl("https://app.example.com", "tok/2")
    ).toBe("https://app.example.com/v1/public/artifact-shares/tok%2F2");
  });
});
