import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLocalAuthToken, verifyLocalAuthToken } from "./local-auth";
import { getUserConfigDir, getUserConfigPath, saveUserConfig } from "./user-config";

describe("loadLocalAuthToken", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.TINYCLAW_CONFIG_DIR;
    delete process.env.TINYCLAW_LOCAL_AUTH_TOKEN;
  });

  test("generates a token when none is configured", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-local-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    const token = await loadLocalAuthToken();
    expect(token).toStartWith("tc_local_");

    const rawConfig = await readFile(getUserConfigPath(), "utf8");
    expect(rawConfig).toContain("local_auth_token_hash=");
    expect(rawConfig).not.toContain(token!);

    const storedToken = await readFile(join(getUserConfigDir(), "local-auth-token"), "utf8");
    expect(storedToken.trim()).toBe(token);
  });

  test("reuses the token from the private local token file", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-local-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;
    const tokenValue = "tc_local_configured_token";

    await saveUserConfig({
      defaultProviderId: null,
      providers: [],
      localAuthTokenHash: createHash("sha256").update(tokenValue).digest("hex"),
    });
    await writeFile(
      join(getUserConfigDir(), "local-auth-token"),
      `${tokenValue}\n`,
      "utf8",
    );

    const token = await loadLocalAuthToken("whatsapp@tinyclaw.internal");
    expect(token).toBe(tokenValue);

    const rawConfig = await readFile(getUserConfigPath(), "utf8");
    expect(rawConfig).toContain("local_auth_token_hash=");
    expect(rawConfig).not.toContain("local_auth_token=tc_local_configured_token");
  });

  test("verifies the configured local auth token", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-local-auth-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    const token = await loadLocalAuthToken();

    await expect(verifyLocalAuthToken(token!)).resolves.toEqual({
      email: "local-client@tinyclaw.internal",
    });
    await expect(verifyLocalAuthToken("wrong-token")).resolves.toBeNull();
  });

  test("prefers env token for production-style setup", async () => {
    process.env.TINYCLAW_LOCAL_AUTH_TOKEN = "tc_local_from_env";
    await expect(loadLocalAuthToken()).resolves.toBe("tc_local_from_env");
    await expect(verifyLocalAuthToken("tc_local_from_env")).resolves.toEqual({
      email: "local-client@tinyclaw.internal",
    });
  });
});
