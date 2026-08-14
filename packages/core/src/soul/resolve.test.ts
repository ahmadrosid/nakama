import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getUserConfigDir } from "../user-config";
import {
  assertConfigPathSegment,
  getOrgMemoryDir,
  getProfileSoulDir,
} from "./resolve";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

describe("assertConfigPathSegment", () => {
  test("accepts slug ids", () => {
    expect(assertConfigPathSegment("org_test", "orgId")).toBe("org_test");
    expect(assertConfigPathSegment("profile_default", "profileId")).toBe(
      "profile_default"
    );
  });

  test("rejects empty, dot, and parent segments", () => {
    expect(() => assertConfigPathSegment("  ", "orgId")).toThrow(/orgId/);
    expect(() => assertConfigPathSegment(".", "orgId")).toThrow(/orgId/);
    expect(() => assertConfigPathSegment("..", "orgId")).toThrow(/orgId/);
  });

  test("rejects path separators", () => {
    expect(() => assertConfigPathSegment("org_a/../org_b", "orgId")).toThrow(
      /orgId/
    );
    expect(() => assertConfigPathSegment("org_a\\org_b", "orgId")).toThrow(
      /orgId/
    );
  });
});

describe("getProfileSoulDir", () => {
  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
  });

  test("resolves under the config orgs tree", () => {
    process.env.NAKAMA_CONFIG_DIR = "/tmp/nakama-config";
    expect(getProfileSoulDir("org_a", "p1")).toBe(
      join(getUserConfigDir(), "orgs", "org_a", "profiles", "p1")
    );
  });

  test("does not escape the config dir via orgId or profileId", () => {
    process.env.NAKAMA_CONFIG_DIR = "/tmp/nakama-config";
    expect(() => getProfileSoulDir("org_a/../org_b", "p1")).toThrow();
    expect(() => getProfileSoulDir("org_a", "..")).toThrow();
    expect(() => getOrgMemoryDir("../other")).toThrow();
  });
});
