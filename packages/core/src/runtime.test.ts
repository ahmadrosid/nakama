import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadUserWebPublicUrl,
  readUserWebPublicUrlSync,
  saveUserWebPublicUrl,
} from "./user-config";
import { resolveWebPublicUrl } from "./runtime";

describe("user config web public url", () => {
  let configDir = "";

  afterEach(() => {
    if (configDir) {
      rmSync(configDir, { recursive: true, force: true });
      configDir = "";
    }
    delete process.env.NAKAMA_CONFIG_DIR;
    delete process.env.NAKAMA_WEB_PUBLIC_URL;
  });

  test("saveUserWebPublicUrl persists to config.ini and resolveWebPublicUrl reads it", async () => {
    configDir = join(tmpdir(), `nakama-user-config-test-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await saveUserWebPublicUrl("https://app.example.com/");
    expect(readUserWebPublicUrlSync()).toBe("https://app.example.com");
    expect(resolveWebPublicUrl({})).toBe("https://app.example.com");
    expect(await loadUserWebPublicUrl()).toBe("https://app.example.com");
  });

  test("env overrides config.ini web public url", async () => {
    configDir = join(tmpdir(), `nakama-user-config-test-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await saveUserWebPublicUrl("https://saved.example.com");

    process.env.NAKAMA_WEB_PUBLIC_URL = "https://env.example.com";

    expect(resolveWebPublicUrl(process.env)).toBe("https://env.example.com");
  });
});
