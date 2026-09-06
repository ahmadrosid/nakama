import { describe, expect, test } from "bun:test";
import { buildPublicArtifactShareUrl } from "./public-artifact-share-url";

describe("buildPublicArtifactShareUrl", () => {
  test("builds relative and absolute share URLs", () => {
    expect(buildPublicArtifactShareUrl("", "tok_1", "meta=1")).toBe(
      "/v1/public/artifact-shares/tok_1?meta=1"
    );
    expect(buildPublicArtifactShareUrl("  ", "tok_1")).toBe(
      "/v1/public/artifact-shares/tok_1"
    );
    expect(
      buildPublicArtifactShareUrl("https://app.example.com/", "tok/2")
    ).toBe("https://app.example.com/v1/public/artifact-shares/tok%2F2");
    expect(buildPublicArtifactShareUrl("http://app.example.com", "tok_1")).toBe(
      "http://app.example.com/v1/public/artifact-shares/tok_1"
    );
  });

  test("rejects non-http protocols", () => {
    expect(() =>
      buildPublicArtifactShareUrl("file:///etc/passwd", "tok_1")
    ).toThrow("unavailable");
    expect(() =>
      buildPublicArtifactShareUrl("javascript:alert(1)", "tok_1")
    ).toThrow("unavailable");
  });

  test("rejects invalid URLs", () => {
    expect(() => buildPublicArtifactShareUrl("not a url", "tok_1")).toThrow(
      "unavailable"
    );
  });

  test("rejects localhost in production", () => {
    expect(() =>
      buildPublicArtifactShareUrl("http://localhost:4310", "tok_1", undefined, {
        isProd: true,
      })
    ).toThrow("unavailable");
    expect(() =>
      buildPublicArtifactShareUrl("http://127.0.0.1:4310", "tok_1", undefined, {
        isProd: true,
      })
    ).toThrow("unavailable");
  });

  test("allows localhost outside production", () => {
    expect(
      buildPublicArtifactShareUrl("http://localhost:4310", "tok_1", undefined, {
        isProd: false,
      })
    ).toBe("http://localhost:4310/v1/public/artifact-shares/tok_1");
  });
});
