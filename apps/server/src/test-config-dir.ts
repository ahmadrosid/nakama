import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function setupTestConfigDir(prefix = "tinyclaw-server-test-"): void {
  const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;
  let testConfigDir = "";

  beforeEach(() => {
    testConfigDir = mkdtempSync(join(tmpdir(), prefix));
    process.env.TINYCLAW_CONFIG_DIR = testConfigDir;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.TINYCLAW_CONFIG_DIR;
    } else {
      process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;
    }

    if (testConfigDir) {
      rmSync(testConfigDir, { recursive: true, force: true });
      testConfigDir = "";
    }
  });
}
