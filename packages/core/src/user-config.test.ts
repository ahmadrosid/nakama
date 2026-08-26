import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaApiError } from "./api-error";
import { pathExists } from "./fs";
import {
  createProviderInstanceId,
  ensureUserConfigDir,
  getUserConfigPath,
  loadUserConfig,
  loadUserWebPublicUrl,
  normalizeProviderInstanceLabel,
  saveUserConfig,
  saveUserTimezone,
  saveUserWebPublicUrl,
} from "./user-config";

describe("saveUserTimezone", () => {
  // readJson casts the body without validating it, so timezone can arrive
  // undefined however the contract types it.
  test("names the missing field and answers 400, not a TypeError at 500", async () => {
    const cases = [
      [undefined, "Timezone is required."],
      ["  ", "Timezone is required."],
      ["Not/AZone", "Invalid timezone: Not/AZone"],
    ] as const;

    for (const [value, message] of cases) {
      try {
        await saveUserTimezone(value);
        throw new Error("expected a rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(NakamaApiError);
        expect((error as NakamaApiError).message).toBe(message);
        expect((error as NakamaApiError).status).toBe(400);
      }
    }
  });
});

describe("ensureUserConfigDir", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("creates the config directory when missing", async () => {
    configDir = join(tmpdir(), `nakama-config-${Date.now()}`);
    process.env.NAKAMA_CONFIG_DIR = configDir;

    expect(await pathExists(configDir)).toBe(false);
    await expect(ensureUserConfigDir()).resolves.toBe(configDir);
    expect(await pathExists(configDir)).toBe(true);
  });
});

describe("user config multi-provider", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("round-trips multiple provider instances", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const openaiId = createProviderInstanceId();
    const compatibleId = createProviderInstanceId();

    await saveUserConfig({
      defaultProviderId: openaiId,
      providers: [
        {
          apiKey: "sk-test",
          createdAt: "2026-06-07T10:00:00.000Z",
          id: openaiId,
          label: "Work OpenAI",
          type: "openai",
        },
        {
          apiKey: "",
          baseUrl: "http://localhost:11434/v1",
          createdAt: "2026-06-07T11:00:00.000Z",
          customModels: [
            {
              default: true,
              id: "llama3.2",
              name: "Llama 3.2",
              supportsThinking: true,
            },
          ],
          id: compatibleId,
          label: "Ollama",
          type: "openai_compatible",
          wireApi: "responses",
        },
      ],
      thinkingEffort: "medium",
      thinkingEnabled: true,
      timezone: "UTC",
    });

    const raw = await readFile(getUserConfigPath(), "utf8");
    expect(raw).toContain(`[provider.${openaiId}]`);
    expect(raw).toContain("label=Ollama");
    expect(raw).toContain("default_provider_id=");

    const loaded = await loadUserConfig();
    expect(loaded?.providers).toHaveLength(2);
    expect(loaded?.defaultProviderId).toBe(openaiId);
    expect(loaded?.providers[1]?.baseUrl).toBe("http://localhost:11434/v1");
    expect(loaded?.providers[1]?.customModels?.[0]?.id).toBe("llama3.2");
    expect(loaded?.providers[1]?.customModels?.[0]?.supportsThinking).toBe(
      true
    );
    expect(loaded?.providers[1]?.wireApi).toBe("responses");
  });

  test("round-trips cerebras models_json with capability flags", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const cerebrasId = createProviderInstanceId();

    await saveUserConfig({
      defaultProviderId: cerebrasId,
      providers: [
        {
          apiKey: "csk-test",
          createdAt: "2026-07-16T10:00:00.000Z",
          customModels: [
            {
              default: true,
              id: "gpt-oss-120b",
              inputPerMillionUsd: 0.25,
              name: "GPT OSS 120B",
              outputPerMillionUsd: 0.69,
              supportsThinking: true,
              supportsVision: false,
            },
          ],
          id: cerebrasId,
          label: "Cerebras",
          type: "cerebras",
        },
      ],
    });

    const loaded = await loadUserConfig();
    expect(loaded?.providers[0]?.type).toBe("cerebras");
    expect(loaded?.providers[0]?.customModels?.[0]?.id).toBe("gpt-oss-120b");
    expect(loaded?.providers[0]?.customModels?.[0]?.supportsThinking).toBe(
      true
    );
    expect(loaded?.providers[0]?.customModels?.[0]?.inputPerMillionUsd).toBe(
      0.25
    );
  });

  test("round-trips fireworks models_json with capability flags", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const fireworksId = createProviderInstanceId();

    await saveUserConfig({
      defaultProviderId: fireworksId,
      providers: [
        {
          apiKey: "fw-test",
          createdAt: "2026-07-24T10:00:00.000Z",
          customModels: [
            {
              default: true,
              id: "accounts/fireworks/models/kimi-k2p6",
              inputPerMillionUsd: 0.6,
              name: "Kimi K2.6",
              outputPerMillionUsd: 2.5,
              supportsThinking: true,
              supportsVision: false,
            },
          ],
          id: fireworksId,
          label: "Fireworks",
          type: "fireworks",
        },
      ],
    });

    const loaded = await loadUserConfig();
    expect(loaded?.providers[0]?.type).toBe("fireworks");
    expect(loaded?.providers[0]?.customModels?.[0]?.id).toBe(
      "accounts/fireworks/models/kimi-k2p6"
    );
    expect(loaded?.providers[0]?.customModels?.[0]?.supportsThinking).toBe(
      true
    );
    expect(loaded?.providers[0]?.customModels?.[0]?.inputPerMillionUsd).toBe(
      0.6
    );
  });

  test("repairs literal undefined label on load", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const id = createProviderInstanceId();

    await writeFile(
      getUserConfigPath(),
      `[provider.${id}]
type=opencode_go
label=undefined
api_key=test-key
created_at=2026-06-15T00:00:00.000Z
`,
      "utf8"
    );

    const loaded = await loadUserConfig();
    expect(loaded?.providers[0]?.label).toBe("OpenCode Go");
  });

  test("normalizeProviderInstanceLabel rejects undefined string", () => {
    expect(normalizeProviderInstanceLabel("openrouter", "undefined", [])).toBe(
      "OpenRouter"
    );
  });

  test("saveUserWebPublicUrl preserves path segments", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await expect(
      saveUserWebPublicUrl("https://gateway.devscale.id/v1/")
    ).resolves.toBe("https://gateway.devscale.id/v1");
    await expect(loadUserWebPublicUrl()).resolves.toBe(
      "https://gateway.devscale.id/v1"
    );
  });
});
