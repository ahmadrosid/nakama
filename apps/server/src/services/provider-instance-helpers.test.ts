import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import {
  applyProviderInstanceUpdate,
  buildProviderInstanceFromCreateRequest,
  modelExistsOnInstance,
  resolveProfileProviderSelection,
} from "./provider-instance-helpers";

function createProviderInstance(
  overrides: Partial<ProviderInstance> &
    Pick<ProviderInstance, "id" | "type" | "label">
): ProviderInstance {
  return {
    apiKey: "test-key",
    createdAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveProfileProviderSelection", () => {
  test("uses the explicitly selected provider instance for provider-qualified profile models", () => {
    const providers: ProviderInstance[] = [
      createProviderInstance({
        id: "zen-1",
        label: "OpenCode Zen",
        type: "opencode_go",
      }),
      createProviderInstance({
        id: "openai-1",
        label: "OpenAI",
        type: "openai",
      }),
    ];

    const resolved = resolveProfileProviderSelection({
      defaultProviderId: "zen-1",
      profileModel: "openai-1::gpt-5.4",
      providers,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.instance.id).toBe("openai-1");
    expect(resolved?.model).toBe("gpt-5.4");
  });

  test("falls back to the provider that actually supports a raw stored model id", () => {
    const providers: ProviderInstance[] = [
      createProviderInstance({
        id: "zen-1",
        label: "OpenCode Zen",
        type: "opencode_go",
      }),
      createProviderInstance({
        id: "openai-1",
        label: "OpenAI",
        type: "openai",
      }),
    ];

    const resolved = resolveProfileProviderSelection({
      defaultProviderId: "zen-1",
      profileModel: "gpt-5.4",
      providers,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.instance.id).toBe("openai-1");
    expect(resolved?.model).toBe("gpt-5.4");
  });

  test("falls back to the default provider when the profile does not override the model", () => {
    const providers: ProviderInstance[] = [
      createProviderInstance({
        id: "zen-1",
        label: "OpenCode Zen",
        type: "opencode_go",
      }),
      createProviderInstance({
        id: "openai-1",
        label: "OpenAI",
        type: "openai",
      }),
    ];

    const resolved = resolveProfileProviderSelection({
      defaultProviderId: "zen-1",
      profileModel: null,
      providers,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.instance.id).toBe("zen-1");
    expect(resolved?.model).toBe("opencode-go/kimi-k2.7-code");
  });

  test("does not treat catalog models as available on unrelated compatible providers", () => {
    const zen = createProviderInstance({
      apiKey: "public",
      baseUrl: "https://opencode.ai/zen/v1",
      customModels: [{ default: true, id: "big-pickle", name: "Big Pickle" }],
      id: "zen-1",
      label: "OpenCode Zen",
      type: "openai_compatible",
    });

    expect(modelExistsOnInstance(zen, "gpt-5.4")).toBe(false);
    expect(modelExistsOnInstance(zen, "big-pickle")).toBe(true);

    const resolved = resolveProfileProviderSelection({
      defaultProviderId: "zen-1",
      profileModel: "gpt-5.4",
      providers: [
        zen,
        createProviderInstance({
          id: "openai-1",
          label: "OpenAI",
          type: "openai",
        }),
      ],
    });

    expect(resolved?.instance.id).toBe("openai-1");
    expect(resolved?.model).toBe("gpt-5.4");
  });
});

describe("applyProviderInstanceUpdate", () => {
  test("preserves supportsThinking on compatible custom models", () => {
    const instance = createProviderInstance({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      customModels: [
        {
          default: true,
          id: "qwen3.6-35b",
          name: "Qwen 3.6 35B",
          supportsThinking: true,
        },
      ],
      id: "compatible-1",
      label: "NetraRuntime",
      type: "openai_compatible",
    });

    const updated = applyProviderInstanceUpdate(instance, {
      customModels: [
        {
          default: true,
          id: "qwen3.6-35b",
          name: "Qwen 3.6 35B",
          supportsThinking: true,
        },
      ],
    });

    expect(updated.customModels?.[0]?.supportsThinking).toBe(true);
  });

  test("stores custom model shortlist for OpenAI", () => {
    const instance = createProviderInstance({
      id: "openai-1",
      label: "OpenAI",
      type: "openai",
    });

    const updated = applyProviderInstanceUpdate(instance, {
      customModels: [
        { default: true, id: "gpt-5.4", name: "GPT 5.4" },
        { id: "gpt-4o-mini", name: "GPT-4o mini" },
      ],
    });

    expect(updated.customModels).toHaveLength(2);
    expect(modelExistsOnInstance(updated, "gpt-5.4")).toBe(true);
    expect(modelExistsOnInstance(updated, "gpt-5.3-codex")).toBe(false);
  });

  test("validates cerebras models against shortlist and static catalog", () => {
    const withShortlist = createProviderInstance({
      customModels: [
        { default: true, id: "gpt-oss-120b", name: "GPT OSS 120B" },
      ],
      id: "cb-1",
      label: "Cerebras",
      type: "cerebras",
    });

    expect(modelExistsOnInstance(withShortlist, "gpt-oss-120b")).toBe(true);
    expect(modelExistsOnInstance(withShortlist, "gemma-4-31b")).toBe(false);

    const withoutShortlist = createProviderInstance({
      id: "cb-2",
      label: "Cerebras",
      type: "cerebras",
    });

    expect(modelExistsOnInstance(withoutShortlist, "gemma-4-31b")).toBe(true);
    expect(modelExistsOnInstance(withoutShortlist, "unknown-model")).toBe(
      false
    );
  });

  test("validates fireworks models against shortlist and static catalog", () => {
    const withShortlist = createProviderInstance({
      customModels: [
        {
          default: true,
          id: "accounts/fireworks/models/kimi-k2p6",
          name: "Kimi K2.6",
        },
      ],
      id: "fw-1",
      label: "Fireworks",
      type: "fireworks",
    });

    expect(
      modelExistsOnInstance(
        withShortlist,
        "accounts/fireworks/models/kimi-k2p6"
      )
    ).toBe(true);
    expect(
      modelExistsOnInstance(withShortlist, "accounts/fireworks/models/glm-5p2")
    ).toBe(false);

    const withoutShortlist = createProviderInstance({
      id: "fw-2",
      label: "Fireworks",
      type: "fireworks",
    });

    expect(
      modelExistsOnInstance(
        withoutShortlist,
        "accounts/fireworks/models/glm-5p2"
      )
    ).toBe(true);
    expect(
      modelExistsOnInstance(withoutShortlist, "accounts/unknown/models/foo")
    ).toBe(false);
  });
});

describe("buildProviderInstanceFromCreateRequest", () => {
  test("persists a Cloudflare Workers AI base URL on the instance", () => {
    const instance = buildProviderInstanceFromCreateRequest(
      {
        apiKey: "cf-key",
        baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
        type: "cloudflare",
      },
      []
    );

    expect(instance.type).toBe("cloudflare");
    expect(instance.baseUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1"
    );
  });
});
