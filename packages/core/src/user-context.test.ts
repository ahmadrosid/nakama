import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getUserContextPath,
  getUserContextStatus,
  loadUserContext,
} from "./user-context";

const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;
let testConfigDir = "";

beforeEach(async () => {
  testConfigDir = join(tmpdir(), `tinyclaw-user-context-${Date.now()}-${Math.random()}`);
  process.env.TINYCLAW_CONFIG_DIR = testConfigDir;
  await mkdir(testConfigDir, { recursive: true });
});

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.TINYCLAW_CONFIG_DIR;
  } else {
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;
  }

  await rm(testConfigDir, { recursive: true, force: true });
});

test("loadUserContext returns undefined when file is missing", async () => {
  expect(await loadUserContext()).toBeUndefined();
});

test("loadUserContext returns undefined when file is empty", async () => {
  await writeFile(getUserContextPath(), "   \n", "utf8");
  expect(await loadUserContext()).toBeUndefined();
});

test("loadUserContext returns trimmed content", async () => {
  await writeFile(getUserContextPath(), "  # About Me\n\nHello\n  ", "utf8");
  expect(await loadUserContext()).toBe("# About Me\n\nHello");
});

test("getUserContextStatus includes content when active", async () => {
  await writeFile(getUserContextPath(), "# About Me", "utf8");
  const status = await getUserContextStatus();

  expect(status.active).toBe(true);
  expect(status.path).toBe(getUserContextPath());
  expect(status.content).toBe("# About Me");
});
