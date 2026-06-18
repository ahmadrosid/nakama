import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { jwtVerify } from "jose";
import { loadLocalAuthToken } from "./local-auth";
import { saveUserConfig } from "./user-config";

describe("loadLocalAuthToken", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.TINYCLAW_CONFIG_DIR;
  });

  test("returns null when no jwt secret is configured", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-local-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    expect(await loadLocalAuthToken()).toBeNull();
  });

  test("creates a bearer token from the local jwt secret", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-local-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    await saveUserConfig({
      defaultProviderId: null,
      providers: [],
      jwtSecret: "test-secret-key-1234567890",
    });

    const token = await loadLocalAuthToken("whatsapp@tinyclaw.internal");
    expect(token).not.toBeNull();

    const verified = await jwtVerify(
      token!,
      new TextEncoder().encode("test-secret-key-1234567890"),
      { clockTolerance: 60 },
    );

    expect(verified.payload.email).toBe("whatsapp@tinyclaw.internal");
  });
});
