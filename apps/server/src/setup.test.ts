import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProviderInstanceId,
  getUserConfigPath,
  isProviderConfigured,
  loadUserConfig,
  saveUserConfig,
} from "@nakama/core";
import { ensureProviderConfigured } from "./setup";

describe("isProviderConfigured", () => {
  test("treats env API keys as configured when config.ini stores an empty key", () => {
    const id = createProviderInstanceId();

    expect(
      isProviderConfigured(
        {
          defaultProviderId: id,
          providers: [
            {
              id,
              type: "openai",
              label: "OpenAI",
              apiKey: "",
              createdAt: "2026-06-07T10:00:00.000Z",
            },
          ],
        },
        { OPENAI_API_KEY: "sk-test" },
      ),
    ).toBe(true);
  });
});

describe("ensureProviderConfigured", () => {
  let configDir = "";
  const envKeys = [
    "NAKAMA_CONFIG_DIR",
    "NAKAMA_PROVIDER",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
  ] as const;
  const previousEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  afterEach(async () => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }
  });

  function snapshotEnv(): void {
    for (const key of envKeys) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  test("bootstraps provider config from env vars when config.ini is missing", async () => {
    snapshotEnv();
    configDir = await mkdtemp(join(tmpdir(), "nakama-setup-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    process.env.NAKAMA_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";

    const { provider, userConfig } = await ensureProviderConfigured();

    expect(provider).not.toBeNull();
    expect(userConfig?.defaultProviderId).toBeTruthy();
    expect(userConfig?.providers).toHaveLength(1);
    expect(userConfig?.providers[0]?.type).toBe("openai");
    expect(userConfig?.providers[0]?.apiKey).toBe("");

    const loaded = await loadUserConfig();
    expect(loaded?.defaultProviderId).toBe(userConfig?.defaultProviderId);
    expect(isProviderConfigured(loaded, process.env)).toBe(true);
    expect(getUserConfigPath()).toContain(configDir);
  });
});
