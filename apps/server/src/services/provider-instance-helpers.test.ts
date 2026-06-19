import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@tinyclaw/core";
import {
  applyProviderInstanceUpdate,
  resolveProfileProviderSelection,
} from "./provider-instance-helpers";

function createProviderInstance(
  overrides: Partial<ProviderInstance> & Pick<ProviderInstance, "id" | "type" | "label">,
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
        type: "opencode_go",
        label: "OpenCode Zen",
      }),
      createProviderInstance({
        id: "openai-1",
        type: "openai",
        label: "OpenAI",
      }),
    ];

    const resolved = resolveProfileProviderSelection({
      providers,
      defaultProviderId: "zen-1",
      profileModel: "openai-1::gpt-5.4",
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.instance.id).toBe("openai-1");
    expect(resolved?.model).toBe("gpt-5.4");
  });

  test("falls back to the provider that actually supports a raw stored model id", () => {
    const providers: ProviderInstance[] = [
      createProviderInstance({
        id: "zen-1",
        type: "opencode_go",
        label: "OpenCode Zen",
      }),
      createProviderInstance({
        id: "openai-1",
        type: "openai",
        label: "OpenAI",
      }),
    ];

    const resolved = resolveProfileProviderSelection({
      providers,
      defaultProviderId: "zen-1",
      profileModel: "gpt-5.4",
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.instance.id).toBe("openai-1");
    expect(resolved?.model).toBe("gpt-5.4");
  });

  test("returns null when the profile does not override the model", () => {
    const providers: ProviderInstance[] = [
      createProviderInstance({
        id: "zen-1",
        type: "opencode_go",
        label: "OpenCode Zen",
      }),
      createProviderInstance({
        id: "openai-1",
        type: "openai",
        label: "OpenAI",
      }),
    ];

    const resolved = resolveProfileProviderSelection({
      providers,
      defaultProviderId: "zen-1",
      profileModel: null,
    });

    expect(resolved).toBeNull();
  });
});

describe("applyProviderInstanceUpdate", () => {
  test("preserves supportsThinking on compatible custom models", () => {
    const instance = createProviderInstance({
      id: "compatible-1",
      type: "openai_compatible",
      label: "NetraRuntime",
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      customModels: [
        {
          id: "qwen3.6-35b",
          name: "Qwen 3.6 35B",
          default: true,
          supportsThinking: true,
        },
      ],
    });

    const updated = applyProviderInstanceUpdate(instance, {
      customModels: [
        {
          id: "qwen3.6-35b",
          name: "Qwen 3.6 35B",
          default: true,
          supportsThinking: true,
        },
      ],
    });

    expect(updated.customModels?.[0]?.supportsThinking).toBe(true);
  });
});
