import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { serve } from "bun";
import {
  compatibleModelSupportsThinking,
  fetchRemoteOpenAIModels,
  getModelsForProviderInstance,
  mergeOpenRouterCatalog,
} from "./compatible-models";

let mockServer: ReturnType<typeof serve> | undefined;

afterEach(() => {
  mockServer?.stop(true);
  mockServer = undefined;
});

describe("mergeOpenRouterCatalog", () => {
  test("merges custom display names over static entries", () => {
    const staticModels = [
      {
        contextWindow: 200_000,
        id: "anthropic/claude-sonnet-4-6",
        maxOutputTokens: 8192,
        name: "Claude Sonnet 4.6",
        provider: "openrouter" as const,
      },
      {
        contextWindow: 128_000,
        id: "openai/gpt-5.4",
        maxOutputTokens: 8192,
        name: "GPT-5.4",
        provider: "openrouter" as const,
      },
    ];
    const merged = mergeOpenRouterCatalog(staticModels, [
      { id: "anthropic/claude-sonnet-4-6", name: "My Sonnet" },
      { id: "google/gemini-2.5-pro-preview", name: "Gemini Pro" },
    ]);

    expect(
      merged.find((model) => model.id === "anthropic/claude-sonnet-4-6")?.name
    ).toBe("My Sonnet");
    expect(merged.some((model) => model.id === "openai/gpt-5.4")).toBe(true);
    expect(
      merged.some((model) => model.id === "google/gemini-2.5-pro-preview")
    ).toBe(true);
  });
});

describe("getModelsForProviderInstance openai", () => {
  test("uses shortlist when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [{ default: true, id: "gpt-5.4", name: "GPT 5.4" }],
      id: "openai-1",
      label: "OpenAI",
      type: "openai",
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("gpt-5.4");
    expect(models[0]?.providerId).toBe("openai-1");
  });

  test("returns full catalog when no shortlist is saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      id: "openai-1",
      label: "OpenAI",
      type: "openai",
    });

    expect(models.length).toBeGreaterThan(1);
    expect(models.some((model) => model.id === "gpt-5.4")).toBe(true);
  });
});

describe("getModelsForProviderInstance opencode_go", () => {
  test("uses shortlist when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "oc-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        { default: true, id: "opencode-go/kimi-k2.7-code", name: "Kimi Code" },
      ],
      id: "oc-1",
      label: "OpenCode Go",
      type: "opencode_go",
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("opencode-go/kimi-k2.7-code");
    expect(models[0]?.providerId).toBe("oc-1");
  });

  test("returns full catalog when no shortlist is saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "oc-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      id: "oc-1",
      label: "OpenCode Go",
      type: "opencode_go",
    });

    expect(models.length).toBeGreaterThan(1);
    expect(
      models.some((model) => model.id === "opencode-go/kimi-k2.7-code")
    ).toBe(true);
  });
});

describe("getModelsForProviderInstance openrouter", () => {
  test("uses shortlist only when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama Free" },
      ],
      id: "or-1",
      label: "OpenRouter",
      type: "openrouter",
    });

    expect(
      models.some(
        (model) => model.id === "meta-llama/llama-3.3-70b-instruct:free"
      )
    ).toBe(true);
    expect(models.some((model) => model.id === "openai/gpt-5.4")).toBe(false);
    expect(models[0]?.providerId).toBe("or-1");
    expect(models[0]?.supportsThinking).toBe(false);
  });

  test("maps supportsThinking for reasoning-capable OpenRouter models", () => {
    const models = getModelsForProviderInstance({
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        { default: true, id: "anthropic/claude-sonnet-4-6", name: "Sonnet" },
      ],
      id: "or-1",
      label: "OpenRouter",
      type: "openrouter",
    });

    expect(models[0]?.supportsThinking).toBe(true);
  });

  test("honors explicit supportsThinking overrides", () => {
    const models = getModelsForProviderInstance({
      apiKey: "sk-test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        { id: "some-vendor/some-model", supportsThinking: true },
        { id: "anthropic/claude-sonnet-4-6", supportsThinking: false },
      ],
      id: "or-1",
      label: "OpenRouter",
      type: "openrouter",
    });

    expect(
      models.find((model) => model.id === "some-vendor/some-model")
        ?.supportsThinking
    ).toBe(true);
    expect(
      models.find((model) => model.id === "anthropic/claude-sonnet-4-6")
        ?.supportsThinking
    ).toBe(false);
  });

  test("includes only the active model when no shortlist is saved", () => {
    const models = getModelsForProviderInstance(
      {
        apiKey: "sk-test",
        createdAt: "2026-06-07T10:00:00.000Z",
        id: "or-1",
        label: "OpenRouter",
        type: "openrouter",
      },
      "google/gemma-4-31b-it:free"
    );

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("google/gemma-4-31b-it:free");
    expect(models[0]?.supportsThinking).toBe(false);
    expect(models.some((model) => model.id === "openai/gpt-5.4")).toBe(false);
  });
});

describe("getModelsForProviderInstance cerebras", () => {
  test("uses shortlist only when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "csk-test",
      createdAt: "2026-07-16T10:00:00.000Z",
      customModels: [
        { id: "gpt-oss-120b", name: "GPT OSS 120B", supportsThinking: true },
      ],
      id: "cb-1",
      label: "Cerebras",
      type: "cerebras",
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("gpt-oss-120b");
    expect(models[0]?.supportsThinking).toBe(true);
    expect(models[0]?.providerId).toBe("cb-1");
    expect(models.some((model) => model.id === "gemma-4-31b")).toBe(false);
  });

  test("falls back to static catalog when no shortlist is saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "csk-test",
      createdAt: "2026-07-16T10:00:00.000Z",
      id: "cb-1",
      label: "Cerebras",
      type: "cerebras",
    });

    expect(models.some((model) => model.id === "gpt-oss-120b")).toBe(true);
    expect(models.some((model) => model.id === "gemma-4-31b")).toBe(true);
  });
});

describe("getModelsForProviderInstance fireworks", () => {
  test("uses shortlist only when custom models are saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "fw-test",
      createdAt: "2026-07-24T10:00:00.000Z",
      customModels: [
        {
          id: "accounts/fireworks/models/kimi-k2p6",
          name: "Kimi K2.6",
          supportsThinking: true,
        },
      ],
      id: "fw-1",
      label: "Fireworks",
      type: "fireworks",
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("accounts/fireworks/models/kimi-k2p6");
    expect(models[0]?.supportsThinking).toBe(true);
    expect(
      models.some((model) => model.id === "accounts/fireworks/models/glm-5p2")
    ).toBe(false);
  });

  test("falls back to static catalog when no shortlist is saved", () => {
    const models = getModelsForProviderInstance({
      apiKey: "fw-test",
      createdAt: "2026-07-24T10:00:00.000Z",
      id: "fw-1",
      label: "Fireworks",
      type: "fireworks",
    });

    expect(
      models.some((model) => model.id === "accounts/fireworks/models/kimi-k2p6")
    ).toBe(true);
    expect(
      models.some((model) => model.id === "accounts/fireworks/models/glm-5p2")
    ).toBe(true);
  });
});

describe("getModelsForProviderInstance openai_compatible", () => {
  test("maps supportsThinking from custom models into the catalog", () => {
    const models = getModelsForProviderInstance({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        {
          default: true,
          id: "qwen3.6-35b",
          name: "Qwen 3.6 35B",
          supportsThinking: true,
        },
      ],
      id: "compat-1",
      label: "NetraRuntime",
      type: "openai_compatible",
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
      ])
    ).toBe(true);

    expect(
      compatibleModelSupportsThinking("qwen3.6-7b", [
        { id: "qwen3.6-35b", supportsThinking: true },
        { id: "qwen3.6-7b" },
      ])
    ).toBe(false);
  });
});

describe("fetchRemoteOpenAIModels auth errors", () => {
  for (const status of [401, 403] as const) {
    test(`names the API key remedy for ${status} without upstream body`, async () => {
      const upstreamBody = JSON.stringify({
        error: "API key required for remote API access",
      });
      const warn = spyOn(console, "warn").mockImplementation(() => {});

      mockServer = serve({
        fetch() {
          return new Response(upstreamBody, {
            headers: { "content-type": "application/json" },
            status,
          });
        },
        port: 0,
      });

      const baseUrl = `http://127.0.0.1:${mockServer.port}/v1`;

      try {
        await fetchRemoteOpenAIModels(baseUrl, "");
        expect.unreachable("expected discovery to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("API key");
        expect(message).not.toContain(upstreamBody);
        expect(message).not.toContain("API key required for remote API access");
      }

      expect(
        warn.mock.calls.some(
          (args) =>
            typeof args[0] === "string" &&
            args[0].includes("Could not fetch models") &&
            String(args[1] ?? args[0]).includes(upstreamBody)
        )
      ).toBe(true);

      warn.mockRestore();
    });
  }
});
