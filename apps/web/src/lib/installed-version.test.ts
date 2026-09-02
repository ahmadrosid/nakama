import { describe, expect, test } from "bun:test";
import { installedVersionLabel } from "./installed-version";

describe("installedVersionLabel", () => {
  test("returns a trimmed version string", () => {
    expect(installedVersionLabel(" 0.4.6 ")).toBe("0.4.6");
  });

  test("hides empty or missing values", () => {
    expect(installedVersionLabel(undefined)).toBeNull();
    expect(installedVersionLabel(null)).toBeNull();
    expect(installedVersionLabel("")).toBeNull();
    expect(installedVersionLabel("   ")).toBeNull();
  });
});
