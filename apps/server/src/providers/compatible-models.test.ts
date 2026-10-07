import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import { serve } from "bun";
import {
  compatibleModelSupportsThinking,
  customModelEntryFromRemoteRecord,
  fetchNetraModels,
  fetchRemoteOpenAIModels,
  getModelsForProviderInstance,
  inferRemoteModelVision,
} from "./compatible-models";

let mockServer: ReturnType<typeof serve> | undefined;
const originalFetch = globalThis.fetch;

afterEach(() => {
  mockServer?.stop(true);
  mockServer = undefined;
  globalThis.fetch = originalFetch;
});

test("Netra discovery keeps only the documented tool-capable model", async () => {
  globalThis.fetch = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.netraruntime.com/v1/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer test-key"
      );
      return Response.json({
        data: [
          { id: "deepseek/deepseek-v4.1-flash" },
          { id: "deepseek/deepseek-v4-flash-0731" },
        ],
      });
    }
  ) as unknown as typeof fetch;

  expect(await fetchNetraModels("test-key")).toEqual([
    {
      id: "deepseek/deepseek-v4-flash-0731",
      name: "DeepSeek V4 Flash 0731",
      supportsThinking: true,
      supportsVision: false,
    },
  ]);
});

test("Netra agent catalog excludes models without a tool-turn check", () => {
  const models = getModelsForProviderInstance({
    apiKey: "test-key",
    createdAt: "2026-10-05T00:00:00.000Z",
    customModels: [
      { id: "deepseek/deepseek-v4.1-flash" },
      { id: "deepseek/deepseek-v4-flash-0731" },
    ],
    id: "netra-1",
    label: "Netra Runtime",
    type: "netra",
  });
  expect(models.map((model) => model.id)).toEqual([
    "deepseek/deepseek-v4-flash-0731",
  ]);
});

test.each([
  { model: "gpt-5.4", type: "openai" },
  { model: "gpt-5.4", type: "chatgpt" },
  { model: "opencode-go/kimi-k2.7-code", type: "opencode_go" },
  { model: "meta-llama/llama-3.3-70b-instruct:free", type: "openrouter" },
  { model: "gpt-oss-120b", type: "cerebras" },
  { model: "accounts/fireworks/models/kimi-k2p6", type: "fireworks" },
] as const)("$type keeps a saved shortlist", ({ type, model }) => {
  const models = getModelsForProviderInstance({
    apiKey: "test",
    createdAt: "2026-06-07T10:00:00.000Z",
    customModels: [{ id: model }],
    id: type,
    label: type,
    type,
  });
  expect(models.map((entry) => entry.id)).toEqual([model]);
  expect(models[0]?.providerId).toBe(type);
});

test.each([
  { models: ["gpt-5.4"], type: "openai" },
  { models: ["opencode-go/kimi-k2.7-code"], type: "opencode_go" },
  { models: ["gpt-oss-120b", "gemma-4-31b"], type: "cerebras" },
  {
    models: [
      "accounts/fireworks/models/kimi-k2p6",
      "accounts/fireworks/models/glm-5p2",
    ],
    type: "fireworks",
  },
] as const)(
  "$type uses its catalog without a shortlist",
  ({ type, models: expected }) => {
    const models = getModelsForProviderInstance({
      apiKey: "test",
      createdAt: "2026-06-07T10:00:00.000Z",
      id: type,
      label: type,
      type,
    });
    expect(models.length).toBeGreaterThan(1);
    for (const id of expected) {
      expect(models.some((model) => model.id === id)).toBe(true);
    }
  }
);

describe("getModelsForProviderInstance openrouter", () => {
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

  test("maps supportsVision from custom models into the catalog", () => {
    const models = getModelsForProviderInstance({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [
        { id: "qwen-vl", name: "Qwen VL", supportsVision: true },
        { id: "qwen-text", name: "Qwen Text" },
      ],
      id: "compat-1",
      label: "Custom",
      type: "openai_compatible",
    });

    expect(models.find((model) => model.id === "qwen-vl")?.supportsVision).toBe(
      true
    );
    expect(
      models.find((model) => model.id === "qwen-text")?.supportsVision
    ).toBeUndefined();
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

describe("inferRemoteModelVision", () => {
  test("reads explicit supports_vision flags", () => {
    expect(inferRemoteModelVision({ supports_vision: true })).toBe(true);
    expect(inferRemoteModelVision({ supportsVision: false })).toBe(false);
  });
});

describe("customModelEntryFromRemoteRecord", () => {
  test("copies inferred vision onto the custom model entry", () => {
    expect(
      customModelEntryFromRemoteRecord({
        architecture: { input_modalities: ["image"] },
        id: "qwen-vl",
        name: "Qwen VL",
      })
    ).toEqual({
      id: "qwen-vl",
      name: "Qwen VL",
      supportsVision: true,
    });
  });
});

for (const status of [401, 403, 503] as const) {
  test(`remote discovery handles ${status} without exposing its body`, async () => {
    const upstreamBody = "private upstream details";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    mockServer = serve({
      fetch: () => new Response(upstreamBody, { status }),
      port: 0,
    });

    try {
      await fetchRemoteOpenAIModels(
        `http://127.0.0.1:${mockServer.port}/v1`,
        "key"
      );
      expect.unreachable("expected discovery to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NakamaApiError);
      expect((error as NakamaApiError).status).toBe(status === 503 ? 502 : 400);
      expect((error as NakamaApiError).message).not.toContain(upstreamBody);
      if (status !== 503) {
        expect((error as NakamaApiError).message).toContain("API key");
      }
    } finally {
      warn.mockRestore();
    }
  });
}
