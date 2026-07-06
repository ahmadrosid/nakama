import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LocalAuthTokenManagedExternallyError,
  loadLocalAuthToken,
  rotateLocalAuthToken,
  verifyLocalAuthToken,
} from "./local-auth";
import { getUserConfigDir, getUserConfigPath, saveUserConfig } from "./user-config";

describe("loadLocalAuthToken", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
    delete process.env.nakama_LOCAL_AUTH_TOKEN;
  });

  test("generates a token when none is configured", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-local-auth-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const token = await loadLocalAuthToken();
    expect(token).toStartWith("tc_local_");

    const rawConfig = await readFile(getUserConfigPath(), "utf8");
    expect(rawConfig).toContain("local_auth_token_hash=");
    expect(rawConfig).not.toContain(token!);

    const storedToken = await readFile(join(getUserConfigDir(), "local-auth-token"), "utf8");
    expect(storedToken.trim()).toBe(token);
  });

  test("reuses the token from the private local token file", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-local-auth-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
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

    const token = await loadLocalAuthToken("whatsapp@nakama.internal");
    expect(token).toBe(tokenValue);

    const rawConfig = await readFile(getUserConfigPath(), "utf8");
    expect(rawConfig).toContain("local_auth_token_hash=");
    expect(rawConfig).not.toContain("local_auth_token=tc_local_configured_token");
  });

  test("verifies the configured local auth token", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-local-auth-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const token = await loadLocalAuthToken();

    await expect(verifyLocalAuthToken(token!)).resolves.toEqual({
      email: "local-client@nakama.internal",
    });
    await expect(verifyLocalAuthToken("wrong-token")).resolves.toBeNull();
  });

  test("prefers env token for production-style setup", async () => {
    process.env.nakama_LOCAL_AUTH_TOKEN = "tc_local_from_env";
    await expect(loadLocalAuthToken()).resolves.toBe("tc_local_from_env");
    await expect(verifyLocalAuthToken("tc_local_from_env")).resolves.toEqual({
      email: "local-client@nakama.internal",
    });
  });

  test("rotateLocalAuthToken replaces the stored token and invalidates the old one", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-local-auth-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const original = await loadLocalAuthToken();
    const rotated = await rotateLocalAuthToken();

    expect(rotated).toStartWith("tc_local_");
    expect(rotated).not.toBe(original);
    await expect(verifyLocalAuthToken(original!)).resolves.toBeNull();
    await expect(verifyLocalAuthToken(rotated)).resolves.toEqual({
      email: "local-client@nakama.internal",
    });
    await expect(loadLocalAuthToken()).resolves.toBe(rotated);
  });

  test("rotateLocalAuthToken refuses when the token comes from env", async () => {
    process.env.nakama_LOCAL_AUTH_TOKEN = "tc_local_from_env";
    await expect(rotateLocalAuthToken()).rejects.toBeInstanceOf(
      LocalAuthTokenManagedExternallyError,
    );
  });
});
