import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getUserConfigDir } from "../user-config";
import {
  assertConfigPathSegment,
  ensureAppUserSoulDir,
  getAppUserSoulDir,
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

describe("app user soul workspaces", () => {
  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
  });

  test("uses a stable isolated path for each app user", () => {
    process.env.NAKAMA_CONFIG_DIR = "/tmp/nakama-config";
    expect(getAppUserSoulDir("org_a", "p1", "alice")).toBe(
      getAppUserSoulDir("org_a", "p1", "alice")
    );
    expect(getAppUserSoulDir("org_a", "p1", "alice")).not.toBe(
      getAppUserSoulDir("org_a", "p1", "bob")
    );
    expect(getAppUserSoulDir("org_a", "p1", "alice")).not.toContain("alice");
    expect(() => getAppUserSoulDir("org_a", "p1", "  ")).toThrow(/appUserId/);
  });

  test("bootstraps identity files without copying private memory", async () => {
    const configDir = "/tmp/nakama-app-user-workspace-test";
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const source = getProfileSoulDir("org_a", "p1");
    const { mkdir, rm, writeFile } = await import("node:fs/promises");
    await rm(configDir, { force: true, recursive: true });
    await mkdir(join(source, "examples"), { recursive: true });
    await writeFile(join(source, "SOUL.md"), "shared identity");
    await writeFile(join(source, "MEMORY.md"), "shared memory");
    await writeFile(join(source, "examples", "one.md"), "example");

    const target = await ensureAppUserSoulDir("org_a", "p1", "alice");
    expect(await Bun.file(join(target, "SOUL.md")).text()).toBe(
      "shared identity"
    );
    expect(await Bun.file(join(target, "examples", "one.md")).text()).toBe(
      "example"
    );
    expect(await Bun.file(join(target, "MEMORY.md")).exists()).toBe(false);
    await rm(configDir, { force: true, recursive: true });
  });
});
