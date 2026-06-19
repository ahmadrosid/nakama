import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProviderInstanceId,
  getUserConfigPath,
  loadUserConfig,
  normalizeProviderInstanceLabel,
  saveUserConfig,
} from "./user-config";

describe("user config multi-provider", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.TINYCLAW_CONFIG_DIR;
  });

  test("round-trips multiple provider instances", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-config-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    const openaiId = createProviderInstanceId();
    const compatibleId = createProviderInstanceId();

    await saveUserConfig({
      defaultProviderId: openaiId,
      timezone: "UTC",
      thinkingEnabled: true,
      thinkingEffort: "medium",
      providers: [
        {
          id: openaiId,
          type: "openai",
          label: "Work OpenAI",
          apiKey: "sk-test",
          createdAt: "2026-06-07T10:00:00.000Z",
        },
        {
          id: compatibleId,
          type: "openai_compatible",
          label: "Ollama",
          apiKey: "",
          baseUrl: "http://localhost:11434/v1",
          customModels: [
            {
              id: "llama3.2",
              name: "Llama 3.2",
              default: true,
              supportsThinking: true,
            },
          ],
          createdAt: "2026-06-07T11:00:00.000Z",
        },
      ],
    });

    const raw = await readFile(getUserConfigPath(), "utf8");
    expect(raw).toContain(`[provider.${openaiId}]`);
    expect(raw).toContain("label=Ollama");
    expect(raw).toContain("default_provider_id=");

    const loaded = await loadUserConfig();
    expect(loaded?.providers).toHaveLength(2);
    expect(loaded?.defaultProviderId).toBe(openaiId);
    expect(loaded?.providers[1]?.customModels?.[0]?.id).toBe("llama3.2");
    expect(loaded?.providers[1]?.customModels?.[0]?.supportsThinking).toBe(true);
  });

  test("repairs literal undefined label on load", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-config-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    const id = createProviderInstanceId();

    await writeFile(
      getUserConfigPath(),
      `[provider.${id}]
type=opencode_go
label=undefined
api_key=test-key
created_at=2026-06-15T00:00:00.000Z
`,
      "utf8",
    );

    const loaded = await loadUserConfig();
    expect(loaded?.providers[0]?.label).toBe("OpenCode Go");
  });

  test("normalizeProviderInstanceLabel rejects undefined string", () => {
    expect(
      normalizeProviderInstanceLabel("openrouter", "undefined", []),
    ).toBe("OpenRouter");
  });
});
