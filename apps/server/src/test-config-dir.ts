import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTestEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => T | Promise<T>
): Promise<T> {
  const previous = new Map(
    Object.keys(vars).map((key) => [key, process.env[key]] as const)
  );
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function setupTestConfigDir(prefix = "nakama-server-test-"): void {
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
  let testConfigDir = "";

  beforeEach(() => {
    testConfigDir = mkdtempSync(join(tmpdir(), prefix));
    process.env.NAKAMA_CONFIG_DIR = testConfigDir;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (testConfigDir) {
      rmSync(testConfigDir, { force: true, recursive: true });
      testConfigDir = "";
    }
  });
}
