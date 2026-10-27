import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvValue, setManagedSecretResolver } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ManagedSecrets } from "./services/managed-secrets";

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

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (testConfigDir) {
      await removeTestDir(testConfigDir);
      testConfigDir = "";
    }
  });
}

/**
 * Windows refuses to delete a folder a just-killed child still holds as its
 * cwd. Bun 1.4 parses rm's maxRetries/retryDelay but does not apply them.
 */
export async function removeTestDir(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(dir, { force: true, recursive: true });

      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EBUSY", "EPERM", "ENOTEMPTY"].includes(
          // SAFETY: Bun file-system busy errors expose Node's standard errno code.
          (error as NodeJS.ErrnoException).code ?? ""
        )
      ) {
        throw error;
      }

      await Bun.sleep(100 * (attempt + 1));
    }
  }
}

/**
 * A fresh encrypted secret store per test, behind the resolver that code
 * reading saved secrets uses. Returns a getter for the current test's store.
 */
export function setupTestManagedSecrets(): () => ManagedSecrets {
  let secrets: ManagedSecrets;

  beforeEach(() => {
    secrets = new ManagedSecrets(
      createInMemoryDatabaseAdapter(),
      Buffer.alloc(32, 1).toString("base64")
    );
    setManagedSecretResolver(
      async (scope, name, envNames) =>
        (await secrets.resolve(scope, name, envNames)).value
    );
  });

  afterEach(() => {
    // Back to the default: env overrides only.
    setManagedSecretResolver(
      async (_scope, _name, envNames) =>
        envNames.map((key) => readEnvValue(process.env, key)).find(Boolean) ??
        null
    );
  });

  return () => secrets;
}
