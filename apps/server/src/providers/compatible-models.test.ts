import { describe, expect, test } from "bun:test";
import {
  compatibleModelSupportsThinking,
  getModelsForProviderInstance,
  mergeOpenRouterCatalog,
} from "./compatible-models";

describe("mergeOpenRouterCatalog", () => {
  test("merges custom display names over static entries", () => {
    const staticModels = [
      {
        id: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider: "openrouter" as const,
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        provider: "openrouter" as const,
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
      },
    ];
    const merged = mergeOpenRouterCatalog(staticModels, [
      { id: "anthropic/claude-sonnet-4-6", name: "My Sonnet" },
      { id: "google/gemini-2.5-pro-preview", name: "Gemini Pro" },
    ]);

    expect(merged.find((model) => model.id === "anthropic/claude-sonnet-4-6")?.name).toBe(
      "My Sonnet",
    );
    expect(merged.some((model) => model.id === "openai/gpt-5.4")).toBe(true);
    expect(merged.some((model) => model.id === "google/gemini-2.5-pro-preview")).toBe(true);
  });
});

describe("getModelsForProviderInstance openai", () => {
  test("uses shortlist when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      id: "openai-1",
      type: "openai",
      label: "OpenAI",
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [{ id: "gpt-5.4", name: "GPT 5.4", default: true }],
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("gpt-5.4");
    expect(models[0]?.providerId).toBe("openai-1");
  });

  test("returns full catalog when no shortlist is saved", () => {
    const models = getModelsForProviderInstance({
      id: "openai-1",
      type: "openai",
      label: "OpenAI",
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
    });

    expect(models.length).toBeGreaterThan(1);
    expect(models.some((model) => model.id === "gpt-5.4")).toBe(true);
  });
});

describe("getModelsForProviderInstance opencode_go", () => {
  test("uses shortlist when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      id: "oc-1",
      type: "opencode_go",
      label: "OpenCode Go",
      apiKey: "oc-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [{ id: "opencode-go/kimi-k2.7-code", name: "Kimi Code", default: true }],
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("opencode-go/kimi-k2.7-code");
    expect(models[0]?.providerId).toBe("oc-1");
  });

  test("returns full catalog when no shortlist is saved", () => {
    const models = getModelsForProviderInstance({
      id: "oc-1",
      type: "opencode_go",
      label: "OpenCode Go",
      apiKey: "oc-test",
      createdAt: "2026-06-07T10:00:00.000Z",
    });

    expect(models.length).toBeGreaterThan(1);
    expect(models.some((model) => model.id === "opencode-go/kimi-k2.7-code")).toBe(true);
  });
});

describe("getModelsForProviderInstance openrouter", () => {
  test("uses shortlist only when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      id: "or-1",
      type: "openrouter",
      label: "OpenRouter",
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [{ id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama Free" }],
    });

    expect(
      models.some((model) => model.id === "meta-llama/llama-3.3-70b-instruct:free"),
    ).toBe(true);
    expect(models.some((model) => model.id === "openai/gpt-5.4")).toBe(false);
    expect(models[0]?.providerId).toBe("or-1");
  });

  test("includes only the active model when no shortlist is saved", () => {
    const models = getModelsForProviderInstance(
      {
        id: "or-1",
        type: "openrouter",
        label: "OpenRouter",
        apiKey: "sk-test",
        createdAt: "2026-06-07T10:00:00.000Z",
      },
      "google/gemma-4-31b-it:free",
    );

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("google/gemma-4-31b-it:free");
    expect(models.some((model) => model.id === "openai/gpt-5.4")).toBe(false);
  });
});

describe("getModelsForProviderInstance openai_compatible", () => {
  test("maps supportsThinking from custom models into the catalog", () => {
    const models = getModelsForProviderInstance({
      id: "compat-1",
      type: "openai_compatible",
      label: "NetraRuntime",
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        { id: "qwen3.6-35b", name: "Qwen 3.6 35B", default: true, supportsThinking: true },
      ],
    });

    expect(models[0]?.supportsThinking).toBe(true);
    expect(models[0]?.providerId).toBe("compat-1");
  });
});

describe("compatibleModelSupportsThinking", () => {
  test("returns true only for models explicitly opted into thinking", () => {
    expect(
      compatibleModelSupportsThinking("qwen3.6-35b", [
        { id: "qwen3.6-35b", supportsThinking: true },
        { id: "qwen3.6-7b" },
      ]),
    ).toBe(true);

    expect(
      compatibleModelSupportsThinking("qwen3.6-7b", [
        { id: "qwen3.6-35b", supportsThinking: true },
        { id: "qwen3.6-7b" },
      ]),
    ).toBe(false);
  });
});
