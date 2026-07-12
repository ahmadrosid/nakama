import { describe, expect, test } from "bun:test";
import type { UserConfig } from "@nakama/core";
import {
  resolvePrimaryModelVisionSupport,
  resolveVisionProviderSelection,
} from "./image-vision-fallback";

describe("resolveVisionProviderSelection", () => {
  test("returns null when vision model is not configured", () => {
    expect(resolveVisionProviderSelection({ defaultProviderId: null, providers: [] })).toBeNull();
  });

  test("resolves configured vision-capable model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-openai",
      visionModel: "p-gemini::gemini-2.5-flash",
      providers: [
        {
          id: "p-gemini",
          type: "gemini",
          label: "Gemini",
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const resolved = resolveVisionProviderSelection(config);
    expect(resolved?.model).toBe("gemini-2.5-flash");
    expect(resolved?.instance.id).toBe("p-gemini");
  });

  test("rejects non-vision custom model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-custom",
      visionModel: "p-custom::text-only",
      providers: [
        {
          id: "p-custom",
          type: "openai_compatible",
          label: "Custom",
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
          customModels: [{ id: "text-only", supportsVision: false }],
        },
      ],
    };

    expect(() => resolveVisionProviderSelection(config)).toThrow(
      'Configured image parsing model "text-only" does not support vision.',
    );
  });
});

describe("resolvePrimaryModelVisionSupport", () => {
  test("returns false for opencode go profile model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-go",
      providers: [
        {
          id: "p-go",
          type: "opencode_go",
          label: "OpenCode Go",
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    expect(
      resolvePrimaryModelVisionSupport(
        config,
        "p-go::opencode-go/kimi-k2.7-code",
      ),
    ).toBe(false);
  });
});
