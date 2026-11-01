import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import { USER_PROVIDER_NAMES } from "@nakama/core/provider-resolution";
import { serve } from "bun";
import {
  compatibleModelSupportsThinking,
  customModelEntryFromRemoteRecord,
  fetchNetraModelLimits,
  fetchNetraModels,
  fetchRemoteOpenAIModels,
  getModelsForProviderInstance,
  inferRemoteModelVision,
} from "./compatible-models";
import { getModelsForProvider } from "./models";
import { asTestFetch } from "./test-helpers";

let mockServer: ReturnType<typeof serve> | undefined;

const originalFetch = globalThis.fetch;

afterEach(() => {
  mockServer?.stop(true);
  mockServer = undefined;
  globalThis.fetch = originalFetch;
});

test("instance shortlists preserve only saved models and their owner", () => {
  for (const type of USER_PROVIDER_NAMES) {
    if (
      !getModelsForProvider(type).length &&
      type !== "openrouter" &&
      type !== "openai_compatible" &&
      type !== "ollama"
    ) {
      continue;
    }

    const models = getModelsForProviderInstance({
      apiKey: "test",
      createdAt: "2026-06-07T10:00:00.000Z",
      customModels: [{ id: "private-model" }],
      id: "instance-one",
      label: "Instance one",
      type,
    });

    expect(models.map((model) => model.id)).toEqual(["private-model"]);
    expect(models[0]?.providerId).toBe("instance-one");
    expect(models[0]?.providerLabel).toBe("Instance one");
  }
});

test("a saved entry's sizes override the catalog's in the picker", () => {
  const catalogModel = getModelsForProvider("openai")[0]!;

  const [model] = getModelsForProviderInstance({
    apiKey: "test",
    createdAt: "2026-06-07T10:00:00.000Z",
    customModels: [
      { contextWindow: 24_000, id: catalogModel.id, maxOutputTokens: 4096 },
    ],
    id: "instance-one",
    label: "Instance one",
    type: "openai",
  });

  expect(model?.contextWindow).toBe(24_000);
  expect(model?.maxOutputTokens).toBe(4096);
});

test("instances without a shortlist expose their provider catalog", () => {
  for (const type of USER_PROVIDER_NAMES) {
    const catalog = getModelsForProvider(type);

    if (!catalog.length || type === "openrouter") {
      continue;
    }

    const models = getModelsForProviderInstance({
      apiKey: "test",
      createdAt: "2026-06-07T10:00:00.000Z",
      id: "instance-one",
      label: "Instance one",
      type,
    });

    expect(models.map((model) => model.id)).toEqual(
      catalog.map((model) => model.id)
    );
  }
});

test("Netra model limits are read once and a failed read waits before a retry", async () => {
  let calls = 0;
  globalThis.fetch = asTestFetch(async () => {
    calls += 1;

    if (calls === 1) {
      return new Response("busy", { status: 503 });
    }

    return Response.json({
      data: [
        {
          context_length: 1_048_576,
          id: "deepseek/deepseek-v4.1-flash",
          top_provider: {
            context_length: 1_048_576,
            max_completion_tokens: 131_072,
          },
        },
      ],
    });
  });

  const read = (now?: number) =>
    fetchNetraModelLimits("cache-key", "deepseek/deepseek-v4.1-flash", now);

  const later = Date.now() + 11 * 60_000;
  const limits = { contextWindow: 1_048_576, maxOutputTokens: 131_072 };

  expect(await read()).toEqual({});
  // Within 10 minutes of the failure: no new request, fallback right away.
  expect(await read()).toEqual({});
  expect(calls).toBe(1);
  expect(await read(later)).toEqual(limits);
  expect(await read(later)).toEqual(limits);
  expect(await read()).toEqual(limits);
  expect(calls).toBe(2);
});

test("concurrent Netra model limit reads share one request", async () => {
  let calls = 0;
  globalThis.fetch = asTestFetch(async () => {
    calls += 1;

    return Response.json({
      data: [
        {
          id: "deepseek/deepseek-v4.1-flash",
          top_provider: { max_completion_tokens: 131_072 },
        },
      ],
    });
  });

  const reads = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetchNetraModelLimits("shared-key", "deepseek/deepseek-v4.1-flash")
    )
  );

  expect(reads).toEqual(Array(5).fill({ maxOutputTokens: 131_072 }));
  expect(calls).toBe(1);
});

test("a Netra model list without the model is read again after the retry wait", async () => {
  let calls = 0;
  globalThis.fetch = asTestFetch(async () => {
    calls += 1;

    return Response.json({
      data:
        calls === 1
          ? []
          : [
              {
                context_length: 1_048_576,
                id: "deepseek/deepseek-v4.1-flash",
                top_provider: { max_completion_tokens: 131_072 },
              },
            ],
    });
  });

  const read = (now?: number) =>
    fetchNetraModelLimits("missing-key", "deepseek/deepseek-v4.1-flash", now);

  expect(await read()).toEqual({});
  expect(await read()).toEqual({});
  expect(calls).toBe(1);
  expect(await read(Date.now() + 11 * 60_000)).toEqual({
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
  });
  expect(calls).toBe(2);
});

test("a Netra model limit lookup that times out falls back and is retried later", async () => {
  let calls = 0;
  globalThis.fetch = asTestFetch(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      expect(init?.signal).toBeInstanceOf(AbortSignal);

      if (calls === 1) {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }

      return Response.json({
        data: [
          {
            id: "deepseek/deepseek-v4.1-flash",
            top_provider: { max_completion_tokens: 131_072 },
          },
        ],
      });
    }
  );

  const read = (now?: number) =>
    fetchNetraModelLimits("timeout-key", "deepseek/deepseek-v4.1-flash", now);

  expect(await read()).toEqual({});
  expect(await read(Date.now() + 11 * 60_000)).toEqual({
    maxOutputTokens: 131_072,
  });
  expect(calls).toBe(2);
});

test("Netra discovery keeps only the migration target", async () => {
  globalThis.fetch = asTestFetch(
    mock(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    })
  );

  expect(await fetchNetraModels("test-key")).toEqual([
    {
      id: "deepseek/deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      supportsThinking: true,
      supportsVision: false,
    },
  ]);
});

test("Netra catalog prefers the replacement over retired selections", () => {
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
    "deepseek/deepseek-v4.1-flash",
  ]);
});

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
      // SAFETY: The test reaches this branch with the named error type from the provider contract.
      expect((error as NakamaApiError).status).toBe(status === 503 ? 502 : 400);
      // SAFETY: The test reaches this branch with the named error type from the provider contract.
      expect((error as NakamaApiError).message).not.toContain(upstreamBody);

      if (status !== 503) {
        // SAFETY: The test reaches this branch with the named error type from the provider contract.
        expect((error as NakamaApiError).message).toContain("API key");
      }
    } finally {
      warn.mockRestore();
    }
  });
}

test("Netra upgrades a saved catalog without inheriting retired prices", () => {
  const models = getModelsForProviderInstance({
    apiKey: "test-key",
    createdAt: "2026-10-19T00:00:00.000Z",
    customModels: [
      {
        default: true,
        id: "deepseek/deepseek-v4-flash-0731",
        inputPerMillionUsd: 99,
      },
    ],
    id: "netra-1",
    label: "Netra Runtime",
    type: "netra",
  });

  expect(models).toHaveLength(1);
  expect(models[0]?.id).toBe("deepseek/deepseek-v4.1-flash");
  expect(models[0]?.inputPerMillionUsd).toBeUndefined();
});
