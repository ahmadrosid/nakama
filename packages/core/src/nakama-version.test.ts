import { describe, expect, test } from "bun:test";
import { getNakamaVersion, normalizeNakamaVersion } from "./nakama-version";

describe("normalizeNakamaVersion", () => {
  test("strips a leading v from release tags", () => {
    expect(normalizeNakamaVersion("v0.4.6")).toBe("0.4.6");
    expect(normalizeNakamaVersion("V1.2.3")).toBe("1.2.3");
  });

  test("keeps plain semver unchanged", () => {
    expect(normalizeNakamaVersion("0.4.6")).toBe("0.4.6");
  });
});

describe("getNakamaVersion", () => {
  test("prefers NAKAMA_VERSION over package.json", () => {
    expect(getNakamaVersion({ NAKAMA_VERSION: "v9.9.9" })).toBe("9.9.9");
  });

  test("reads the root package.json version when env is unset", () => {
    const version = getNakamaVersion({});
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
